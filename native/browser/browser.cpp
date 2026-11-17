#include "llama.h"
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
    for (int64_t h = 0; h < heads; ++h) {
        for (int64_t k = 0; k < keys; ++k) {
            capture.mean[k] += values[h*tensor->nb[2]/sizeof(float) + k] / heads;
        }
    }
    return true;
}


static llama_model * model = nullptr;
static llama_context * ctx = nullptr;
static const llama_vocab * vocab = nullptr;
static attention_capture capture;
static std::vector<llama_token> tokens;
static size_t prompt_size = 0, decoded = 0;

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
        vocab = llama_model_get_vocab(model);
        return {{"ready", true}, {"context", 1024}, {"backend", "WASM SIMD, single worker"}};
    }
    if (!ctx) throw std::runtime_error("Load the model first.");
    if (req.at("op") == "init") {
        const std::string prompt = req.at("prompt");
        if (prompt.empty() || prompt.size() > 12000) throw std::runtime_error("Story is empty or too long.");
        int n = -llama_tokenize(vocab, prompt.data(), prompt.size(), nullptr, 0, true, false);
        if (n < 2 || n > 850) throw std::runtime_error("Story reached the mobile context limit. Scrub back to an earlier passage.");
        tokens.resize(n);
        if (llama_tokenize(vocab, prompt.data(), prompt.size(), tokens.data(), n, true, false) != n) throw std::runtime_error("Tokenization failed.");
        llama_memory_clear(llama_get_memory(ctx), true);
        if (!llama_set_attention_bias(ctx, nullptr, 0)) throw std::runtime_error("This model does not support our attention cache.");
        prompt_size = n; decoded = 0;
        while (decoded+1 < tokens.size()) {
            const size_t count = std::min(size_t(64), tokens.size()-1-decoded);
            decode(decoded, count); decoded += count;
        }
        json spans = json::array(); size_t offset = 0;
        std::string rebuilt;
        for (int i = 0; i < n; ++i) {
            const auto text = piece(vocab, tokens[i]); rebuilt += text;
            spans.push_back({{"position", i}, {"id", tokens[i]}, {"text", text}, {"start", offset}, {"end", offset+text.size()}});
            offset += text.size();
        }
        if (rebuilt != prompt) throw std::runtime_error("Model tokenizer does not preserve story offsets.");
        return {{"tokens", spans}, {"prompt_tokens", n}, {"prompt", prompt}};
    }
    if (req.at("op") == "step") {
        if (tokens.empty() || tokens.size() >= 1024) throw std::runtime_error("Context full. Scrub back to continue.");
        std::vector<float> bias(prompt_size, 0.0f);
        for (const auto & item : req.at("bias")) {
            const int p = item.at("position"); const float value = item.at("value");
            if (p < 0 || size_t(p) >= prompt_size || !std::isfinite(value) || std::abs(value) > 8) throw std::runtime_error("Invalid key bias.");
            bias[p] = value;
        }
        if (!llama_set_attention_bias(ctx, bias.data(), bias.size())) throw std::runtime_error("Bias rejected.");
        capture.mean.clear(); decode(decoded, 1); ++decoded;
        capture.mean.resize(std::min(capture.mean.size(), decoded));
        const float * logits = llama_get_logits_ith(ctx, -1);
        const int nv = llama_vocab_n_tokens(vocab);
        std::vector<int> order(nv); std::iota(order.begin(), order.end(), 0);
        std::partial_sort(order.begin(), order.begin()+8, order.end(), [&](int a, int b) { return logits[a] > logits[b]; });
        double sum = 0; for (int i = 0; i < nv; ++i) sum += std::exp(double(logits[i]-logits[order[0]]));
        json top = json::array();
        for (int k = 0; k < 8; ++k) {
            const int id = order[k];
            top.push_back({{"id", id}, {"text", piece(vocab, id)}, {"probability", std::exp(double(logits[id]-logits[order[0]]))/sum}});
        }
        const int next = order[0]; tokens.push_back(next);
        return {{"token", next}, {"text", piece(vocab, next)}, {"done", llama_vocab_is_eog(vocab, next)}, {"top", top}, {"position", decoded-1}, {"bias", req.at("bias")}, {"attention", capture.mean}, {"attention_layer", llama_model_n_layer(model)-1}};
    }
    throw std::runtime_error("Unknown browser operation.");
}

extern "C" EMSCRIPTEN_KEEPALIVE const char * spaceship(const char * input) {
    static std::string response;
    try { response = handle(json::parse(input)).dump(-1, ' ', false, json::error_handler_t::replace); }
    catch (const std::exception & e) { response = json({{"error", e.what()}}).dump(); }
    return response.c_str();
}
