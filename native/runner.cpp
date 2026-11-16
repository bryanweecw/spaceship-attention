#include "llama.h"
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

int main(int argc, char ** argv) {
    if (argc != 2) { std::cerr << "usage: attention-runner model.gguf\n"; return 1; }
    llama_backend_init();
    auto mp = llama_model_default_params();
    mp.n_gpu_layers = 0;
    auto * model = llama_model_load_from_file(argv[1], mp);
    if (!model) return 2;
    attention_capture capture{"kq_soft_max-" + std::to_string(llama_model_n_layer(model)-1), {}};
    auto cp = llama_context_default_params();
    cp.cb_eval = capture_attention; cp.cb_eval_user_data = &capture;
    cp.n_ctx = 2048; cp.n_batch = 512; cp.n_ubatch = 512;
    cp.n_threads = 4; cp.n_threads_batch = 4;
    cp.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_DISABLED;
    auto * ctx = llama_init_from_model(model, cp);
    if (!ctx) { llama_model_free(model); return 3; }
    const auto * vocab = llama_model_get_vocab(model);
    const int nv = llama_vocab_n_tokens(vocab);
    std::vector<llama_token> tokens;
    size_t prompt_size = 0, decoded = 0;
    auto decode = [&](size_t start, size_t count) {
        auto b = llama_batch_init(count, 0, 1);
        b.n_tokens = count;
        for (size_t i = 0; i < count; ++i) {
            b.token[i] = tokens[start+i]; b.pos[i] = start+i;
            b.n_seq_id[i] = 1; b.seq_id[i][0] = 0; b.logits[i] = i+1 == count;
        }
        int result = llama_decode(ctx, b);
        llama_batch_free(b);
        if (result) throw std::runtime_error("llama_decode failed: " + std::to_string(result));
    };
    std::cout << json({{"ready", true}, {"model", argv[1]}, {"context", cp.n_ctx}}).dump() << std::endl;
    for (std::string line; std::getline(std::cin, line);) {
        try {
            auto req = json::parse(line);
            if (req.at("op") == "init") {
                std::string prompt = req.at("prompt");
                if (prompt.empty() || prompt.size() > 16000) throw std::runtime_error("prompt must be 1..16000 bytes");
                int n = -llama_tokenize(vocab, prompt.data(), prompt.size(), nullptr, 0, true, false);
                if (n < 2 || n > 1536) throw std::runtime_error("prompt must tokenize to 2..1536 tokens");
                tokens.resize(n);
                if (llama_tokenize(vocab, prompt.data(), prompt.size(), tokens.data(), n, true, false) != n) throw std::runtime_error("tokenization failed");
                llama_memory_clear(llama_get_memory(ctx), true);
                if (!llama_set_attention_bias(ctx, nullptr, 0)) throw std::runtime_error("model requires standard KV attention cache");
                prompt_size = n; decoded = 0;
                // Leave the final prompt query pending, so even the first output sees the live bias.
                while (decoded+1 < tokens.size()) {
                    size_t count = std::min(size_t(512), tokens.size()-1-decoded);
                    decode(decoded, count); decoded += count;
                }
                json spans = json::array(); size_t offset = 0;
                for (int i = 0; i < n; ++i) {
                    auto text = piece(vocab, tokens[i]);
                    spans.push_back({{"position", i}, {"id", tokens[i]}, {"text", text}, {"start", offset}, {"end", offset+text.size()}});
                    offset += text.size();
                }
                // Byte offsets are exact only if token pieces reconstruct the prompt.
                std::string rebuilt; for (auto token : tokens) rebuilt += piece(vocab, token);
                if (rebuilt != prompt) throw std::runtime_error("this tokenizer adds visible special tokens; use a Qwen2 base GGUF");
                std::cout << json({{"tokens", spans}, {"prompt_tokens", n}, {"prompt", prompt}}).dump(-1, ' ', false, json::error_handler_t::replace) << std::endl;
            } else if (req.at("op") == "step") {
                if (tokens.empty()) throw std::runtime_error("initialize first");
                if (tokens.size() >= cp.n_ctx) throw std::runtime_error("context full; restart with a shorter prompt");
                std::vector<float> bias(prompt_size, 0.0f);
                for (auto & item : req.at("bias")) {
                    int p = item.at("position"); float value = item.at("value");
                    if (p < 0 || size_t(p) >= prompt_size || !std::isfinite(value) || std::abs(value) > 8) throw std::runtime_error("invalid attention bias");
                    bias[p] = value;
                }
                if (!llama_set_attention_bias(ctx, bias.data(), bias.size())) throw std::runtime_error("attention bias rejected");
                capture.mean.clear();
                decode(decoded, 1); ++decoded;
                capture.mean.resize(std::min(capture.mean.size(), decoded));
                const float * logits = llama_get_logits_ith(ctx, -1);
                std::vector<int> order(nv); std::iota(order.begin(), order.end(), 0);
                std::partial_sort(order.begin(), order.begin()+8, order.end(), [&](int a, int b) { return logits[a] > logits[b]; });
                double sum = 0; for (int i = 0; i < nv; ++i) sum += std::exp(double(logits[i]-logits[order[0]]));
                json top = json::array();
                for (int k = 0; k < 8; ++k) {
                    int id = order[k];
                    top.push_back({{"id", id}, {"text", piece(vocab, id)}, {"probability", std::exp(double(logits[id]-logits[order[0]]))/sum}});
                }
                int next = order[0]; tokens.push_back(next);
                std::cout << json({{"token", next}, {"text", piece(vocab, next)}, {"done", llama_vocab_is_eog(vocab, next)}, {"top", top}, {"position", decoded-1}, {"bias", req.at("bias")}, {"attention", capture.mean}, {"attention_layer", llama_model_n_layer(model)-1}}).dump(-1, ' ', false, json::error_handler_t::replace) << std::endl;
            } else throw std::runtime_error("unknown operation");
        } catch (const std::exception & e) { std::cout << json({{"error", e.what()}}).dump() << std::endl; }
    }
    llama_free(ctx); llama_model_free(model); llama_backend_free();
}
