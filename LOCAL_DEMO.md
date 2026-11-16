# Local attention steering

A private derivative of [Chuanqi Sun's Spaceship IDE](https://github.com/chuanqisun/spaceship). The upstream interface illustrates attention locks using prompted phrases (`src/text/live-completion.ts`). This demo implements an attention intervention in llama.cpp. Upstream history, `CITATION.cff`, and the original interface are preserved.

## Run

Requirements: Git, CMake >=3.20, a C++17 compiler, Node 24+, Python 3.10+, curl, and approximately 2 GB of free RAM. No API keys or Python packages are needed. The first setup downloads llama.cpp, npm packages, and a 469 MiB model.

```sh
bash scripts/setup-local.sh
python3 native/server.py --model models/qwen2.5-0.5b-instruct-q4_k_m.gguf
```

Open **http://127.0.0.1:8088**. The server binds only to loopback. It serves the built demo; rebuild with `npm run build` after frontend edits. The original interface remains at `/index.html` and retains its original simulation/cloud modes. Local attention inference is at `/` or `/steer.html`.

1. Load the example prompt.
2. Select `roses`, `greenhouse`, or `garden`. Click tokens individually; shift-click selects a contiguous range.
3. Set the weight, then choose **Compare baseline / steered**. Each path starts from the same prompt, the same neutral prefill, and greedy decoding.
4. Choose **Generate live** and change the selection or weight while text arrives. The new value applies at the next decode boundary without rewriting the prompt or restarting the KV cache.
5. Expand **Next-token probabilities & run evidence** to inspect the latest distribution and download both paths, including every bias applied.

Large weights may reduce fluency or cause repetition. Start at +1 or +2. Attention bias changes probabilities; it is not a guarantee that a theme or word will appear. The small instruction-tuned model is used as a raw text continuation model with no hidden system instructions or chat template.

## What changes inside the model

For a query token q and cached key position k, every attention head/layer uses:

```text
attention(q, k) = softmax_k(Q[q] K[k]^T / sqrt(d) + causal_mask[q,k] + bias[k])
```

A selected key gets a signed additive pre-softmax bias. A value of +2 multiplies its unnormalized odds by exp(2), about 7.39. The final normalized attention still depends on all keys. Negative values suppress selected keys. This is neither output-logit bias, a residual-stream control vector, nor a request to the model to focus on a phrase.

`patches/attention-bias.patch` adds `llama_set_attention_bias(ctx, values, n)` and applies these position weights to the existing KV attention mask. Only finite, already-visible mask entries change: causal, sequence, padding, and sliding-window exclusions remain masked. The runtime stores weights on the context's KV cache and maps actual cache cell positions to the selected prompt positions. Resetting the context clears the bias explicitly. API values are bounded to [-8, 8]; the UI uses [-4, 4].

The demo prefills all but the final prompt token with zero bias. Each step decodes the pending token under the current bias and greedily picks the next token. Therefore bias affects the first output as well as later outputs, without having to reprocess the prompt. It does **not** retroactively recompute earlier hidden states or cached keys/values. That is intentional for interactive steering; a full-prefill intervention would be a separate experiment.

The UI shows selected key positions and actual output probabilities, **not measured attention heatmaps**. Future-vector knobs and inferred focus monitors from the upstream simulation are not implemented in this local demo.

## Scope and runtime

- Pinned llama.cpp revision: `c7518dbec59281c430ca5278ab4e60eadbc88b13`.
- Tested model: `Qwen/Qwen2.5-0.5B-Instruct-GGUF`, `qwen2.5-0.5b-instruct-q4_k_m.gguf` (model license: Apache 2.0).
- CPU inference, four threads, 2,048-token context, flash attention disabled.
- The API rejects models without the standard KV-cache implementation. Hybrid/recurrent, encoder-decoder, MLA, and other cache variants are outside the demonstrated scope. Other models also need token pieces that reconstruct the raw prompt exactly; models adding visible BOS tokens are rejected.
- One active session at a time. A second prompt load invalidates the previous session. Stop finishes the in-flight decode, then halts; restarting generation begins from the prompt again.
- Native process: newline-delimited JSON on stdin/stdout. Python serializes inference operations, validates browser origin, and serves static assets. No model weights, build outputs, browser downloads, credentials, or vendored source are committed.
- The inherited Pages workflow is removed from this private copy. There are no deployment or CI workflows; verification runs locally with the commands below. This also permits pushing with a GitHub credential that has repository access without workflow-write access.

## Verify

```sh
npm run build
python3 tests/test_attention.py -v
# With native/server.py running; uses installed Google Chrome on macOS:
node tests/browser.mjs
# Other Chrome installations:
CHROME_PATH=/path/to/chrome node tests/browser.mjs
```

Real-model tests check neutral equivalence, positive and negative interventions, reproducible reset, live weight changes after identical generated prefixes, byte offsets with Unicode/repeated words, and invalid bias rejection. Browser checks exercise A/B generation, run download, a live weight switch within one session, stopping, mobile overflow, stale-session rejection, and cross-origin rejection.

`evidence/attention-check.json` records actual next-token distributions from the local CPU model. `evidence/browser-check.json` records the browser check results. These are a mechanism check and a basic interactive demo, not a benchmark of semantic steering quality or realtime performance. `tests/test_attention.py` regenerates the model evidence; `tests/browser.mjs` regenerates the browser evidence and saves screenshots/downloads under ignored `.capture-local/`.

The model SHA-256 used for this run is recorded in `evidence/model.sha256`. The setup script preserves existing vendor changes, applies only the pinned patch, and accepts `DOWNLOAD_MODEL=0` to build without fetching weights.
