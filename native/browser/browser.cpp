#include "llama.h"
#include "llama-kv-cache.h"
#include <emscripten/emscripten.h>
#include "ggml-backend.h"
#include "nlohmann/json.hpp"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <iostream>
#include <numeric>
#include <stdexcept>
#include <string>
#include <vector>
using json = nlohmann::ordered_json;

static std::string piece(const llama_vocab * vocab, llama_token token) {
    std::vector<char> buf(256);
    int n = llama_token_to_piece(vocab, token, buf.data(), buf.size(), 0, false);
    if (n < 0) { buf.resize(-n); n = llama_token_to_piece(vocab, token, buf.data(), buf.size(), 0, false); }
    return std::string(buf.data(), n);
}

struct attention_capture {
    std::string tensor_name;
    std::vector<float> mean;
    const llama_kv_cache * cache = nullptr;
};

static bool capture_attention(ggml_tensor * tensor, bool ask, void * user_data) {
    auto & capture = *static_cast<attention_capture *>(user_data);
    const bool selected = capture.tensor_name == ggml_get_name(tensor) && tensor->ne[1] == 1;
    if (ask) return selected;
    if (!selected || tensor->type != GGML_TYPE_F32) return true;
    std::vector<float> values(ggml_nbytes(tensor) / sizeof(float));
    ggml_backend_tensor_get(tensor, values.data(), 0, ggml_nbytes(tensor));
    const int64_t keys = tensor->ne[0], heads = tensor->ne[2];
    capture.mean.assign(keys, 0.0f);
    const auto & cells = capture.cache->get_cells(0);
    for (int64_t h = 0; h < heads; ++h) {
        for (int64_t k = 0; k < keys; ++k) {
            if (size_t(k) >= cells.size() || cells.is_empty(k) || !cells.seq_has(k, 0)) continue;
            const auto position = cells.pos_get(k);
            if (position >= 0 && position < keys) capture.mean[position] += values[h*tensor->nb[2]/sizeof(float) + k] / heads;
        }
    }
    return true;
}


static llama_model * model = nullptr;
static llama_context * ctx = nullptr;
static const llama_vocab * vocab = nullptr;
static attention_capture capture;
static std::vector<llama_token> tokens;
static size_t decoded = 0;
static std::vector<int> positions;
static int next_position = 0;

static void decode(size_t start, size_t count) {
    auto b = llama_batch_init(count, 0, 1);
    b.n_tokens = count;
    for (size_t i = 0; i < count; ++i) {
        b.token[i] = tokens[start+i]; b.pos[i] = start+i;
        b.n_seq_id[i] = 1; b.seq_id[i][0] = 0; b.logits[i] = i+1 == count;
    }
    int result = llama_decode(ctx, b);
    llama_batch_free(b);
    if (result) throw std::runtime_error("decode failed: " + std::to_string(result));
}

static json handle(const json & req) {
    if (req.at("op") == "load") {
        llama_log_set([](ggml_log_level, const char *, void *) {}, nullptr);
        llama_backend_init();
        auto mp = llama_model_default_params();
        mp.n_gpu_layers = 0; mp.load_mode = LLAMA_LOAD_MODE_NONE; mp.lazy_mode = LLAMA_LAZY_MODE_OFF;
        model = llama_model_load_from_file("/model.gguf", mp);
        if (!model) throw std::runtime_error("Model could not load in browser memory.");
        capture.tensor_name = "kq_soft_max-" + std::to_string(llama_model_n_layer(model)-1);
        auto cp = llama_context_default_params();
        cp.n_ctx = 1024; cp.n_batch = 64; cp.n_ubatch = 64;
        cp.n_threads = 1; cp.n_threads_batch = 1;
        cp.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_DISABLED;
        cp.cb_eval = capture_attention; cp.cb_eval_user_data = &capture;
        ctx = llama_init_from_model(model, cp);
        if (!ctx) throw std::runtime_error("Not enough browser memory for the model context.");
        capture.cache = dynamic_cast<const llama_kv_cache *>(llama_get_memory(ctx));
        if (!capture.cache) throw std::runtime_error("Unsupported browser attention cache.");
        vocab = llama_model_get_vocab(model);
        return {{"ready", true}, {"context", 1024}, {"backend", "WASM SIMD, single worker"}};
    }
    if (!ctx) throw std::runtime_error("Load the model first.");
    if (req.at("op") == "init") {
        const std::string prompt = req.at("prompt");
        if (prompt.empty() || prompt.size() > 1200000) throw std::runtime_error("Story is empty or too long.");
        const int n = -llama_tokenize(vocab, prompt.data(), prompt.size(), nullptr, 0, true, false);
        if (n < 2) throw std::runtime_error("Story is too short.");
        std::vector<llama_token> full_tokens(n);
        if (llama_tokenize(vocab, prompt.data(), prompt.size(), full_tokens.data(), n, true, false) != n) throw std::runtime_error("Tokenization failed.");
        json spans = json::array(); size_t offset = 0;
        std::string rebuilt;
        tokens.clear(); positions.clear(); next_position = n;
        // Preserve the story's opening and recent continuation within a bounded attention window.
        for (int i = 0; i < n; ++i) {
            const auto text = piece(vocab, full_tokens[i]); rebuilt += text;
            if (n <= 768 || i < 64 || i >= n-704) {
                spans.push_back({{"position", i}, {"id", full_tokens[i]}, {"text", text}, {"start", offset}, {"end", offset+text.size()}});
                tokens.push_back(full_tokens[i]); positions.push_back(i);
            }
            offset += text.size();
        }
        if (rebuilt != prompt) throw std::runtime_error("Model tokenizer does not preserve story offsets.");
        llama_memory_clear(llama_get_memory(ctx), true);
        if (!llama_set_attention_bias(ctx, nullptr, 0)) throw std::runtime_error("This model does not support our attention cache.");
        decoded = 0;
        while (decoded+1 < tokens.size()) {
            const size_t count = std::min(size_t(64), tokens.size()-1-decoded);
            decode(decoded, count); decoded += count;
        }
        return {{"tokens", spans}, {"prompt_tokens", tokens.size()}, {"total_prompt_tokens", n}, {"context", 1024}, {"prompt", prompt}};
    }
    if (req.at("op") == "step") {
        if (tokens.empty()) throw std::runtime_error("Start the story first.");
        bool shifted = false;
        if (tokens.size() >= 1024) {
            auto memory = llama_get_memory(ctx);
            if (!llama_memory_can_shift(memory) || !llama_memory_seq_rm(memory, 0, 64, 320)) throw std::runtime_error("Could not advance the story attention window.");
            llama_memory_seq_add(memory, 0, 320, -1, -256);
            tokens.erase(tokens.begin()+64, tokens.begin()+320);
            positions.erase(positions.begin()+64, positions.begin()+320);
            decoded -= 256;
            shifted = true;
        }
        std::vector<float> bias(tokens.size(), 0.0f);
        for (const auto & item : req.at("bias")) {
            const int p = item.at("position"); const float value = item.at("value");
            if (p < 0 || p >= next_position || !std::isfinite(value) || std::abs(value) > 8) throw std::runtime_error("Invalid key bias.");
            const auto retained = std::find(positions.begin(), positions.end(), p);
            if (retained != positions.end()) bias[retained-positions.begin()] = value;
        }
        if (!llama_set_attention_bias(ctx, bias.data(), bias.size())) throw std::runtime_error("Bias rejected.");
        capture.mean.clear(); decode(decoded, 1); ++decoded;
        capture.mean.resize(std::min(capture.mean.size(), decoded));
        const int nv = llama_vocab_n_tokens(vocab);
        const float * raw_logits = llama_get_logits_ith(ctx, -1);
        std::vector<float> logits(raw_logits, raw_logits + nv);
        // The canvas asks for an ongoing story; end-of-turn tokens otherwise end raw-prefix completion after a few words.
        for (int i = 0; i < nv; ++i) if (llama_vocab_is_eog(vocab, i)) logits[i] = -INFINITY;
        std::vector<int> order(nv); std::iota(order.begin(), order.end(), 0);
        std::partial_sort(order.begin(), order.begin()+8, order.end(), [&](int a, int b) { return logits[a] > logits[b]; });
        double sum = 0; for (int i = 0; i < nv; ++i) sum += std::exp(double(logits[i]-logits[order[0]]));
        json top = json::array();
        for (int k = 0; k < 8; ++k) {
            const int id = order[k];
            top.push_back({{"id", id}, {"text", piece(vocab, id)}, {"probability", std::exp(double(logits[id]-logits[order[0]]))/sum}});
        }
        const int input_position = positions.back();
        const int output_position = next_position++;
        const int next = order[0]; tokens.push_back(next);
        json retained = shifted ? json(positions) : json(nullptr);
        positions.push_back(output_position);
        return {{"token", next}, {"text", piece(vocab, next)}, {"done", llama_vocab_is_eog(vocab, next)}, {"top", top}, {"position", input_position}, {"next_position", output_position}, {"retained_positions", retained}, {"bias", req.at("bias")}, {"attention", capture.mean}, {"attention_layer", llama_model_n_layer(model)-1}};
    }
    throw std::runtime_error("Unknown browser operation.");
}

extern "C" EMSCRIPTEN_KEEPALIVE const char * spaceship(const char * input) {
    static std::string response;
    try { response = handle(json::parse(input)).dump(-1, ' ', false, json::error_handler_t::replace); }
    catch (const std::exception & e) { response = json({{"error", e.what()}}).dump(); }
    return response.c_str();
}
