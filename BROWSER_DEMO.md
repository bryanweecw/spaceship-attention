# Browser writing demo

Live: https://spaceship-iphone-story.vercel.app

Production deployment `dpl_HDirs4A68oLTKLBZbfh8JnAucVGM` is READY, from implementation commit `b0e4835`. The public URL returns HTTP 200 and serves the verified composer UI and runtime hashes. This revision passed local real-Qwen WebKit composer flows, document attention checks, blank-draft completion and preparation cancellation/recovery. Mobile gesture regressions passed in Chromium with the simulator. The hosted model flow was not rerun on this revision. Physical iPhone 16 behavior and performance remain unverified.

This branch (`demo/iphone-story`) starts from the saved story checkpoint. It retains the original Spaceship canvas, attention boxes, scrubber, fan, rail, and sounds. The code-generation experiment remains on its separate branch.

## Runtime

The same patched llama.cpp revision (`c7518dbec59281c430ca5278ab4e60eadbc88b13`) runs inside a dedicated browser worker, compiled with Emscripten 7.0.0 to WASM32 SIMD. No Python server, local service, API key, hosted inference, JSPI, Memory64, or SharedArrayBuffer is required. This first deployment uses CPU WebAssembly, not WebGPU. It preserves the real additive pre-softmax key bias and the final-layer, head-averaged attention readback.

The start dialog offers Qwen2.5 0.5B Instruct Q4_K_M (default, 469 MiB) and SmolLM2 360M Instruct Q4_K_M (259 MiB). Qwen uses more memory and can run slower; SmolLM remains the smaller option. Each model is downloaded directly from its pinned Hugging Face revision. Reload to choose another model; the last choice is remembered. Their byte counts, SHA-256 values, source URLs, runtime filenames, and toolchain are recorded in `public/runtime/manifest.json`. The worker streams it to the model filesystem and stores 4 MiB chunks in IndexedDB when browser storage is available. Subsequent loads reuse those chunks. Story text and controls stay in the browser.

Context: a sliding 1,024-token attention window; 48 generated tokens per top-up; one inference thread. The runtime retains the fixed story instructions and first 64 story tokens, and shifts out 256 older middle tokens when full, keeping recent text and continuing in the existing KV cache. It remaps measured attention from physical cache cells to the retained story spans. Locks on tokens that leave this window no longer affect decoding; opening locks remain available. Long prefixes after a rewind/steering change are initialized with the fixed framing, first 64 story tokens and a recent tail, for 768 retained tokens total. The 5 MiB WASM stack is required by inference kernels. Memory grows on demand with a 2 GiB address-space ceiling; that ceiling is not the amount allocated on load. Model-file staging is released after loading. Attention snapshots are capped at 256 on this mobile path.

The compiled runtime is checked in so a static deployment needs only `npm ci` and `npm run build`. Weights, the native build, and the compiler installation remain ignored.

## Use

Open the deployed link in Safari on iOS 27. Tap **Load model & start**, allow the initial download and warm-up, then drag the main knob to reveal the story. Landscape gives the original composition more room. Tap a word for a lock, drag the lock to move it, and double-tap a lock to remove it. Double-tap the main knob to expand/release locks; double-tap and hold, then drag outward, for the fan. Visible knobs retain their original appearance with expanded touch hit areas.

The rail reads measured attention, not semantic relevance or causal influence. Local fan axes suppress/amplify their named words. Automatic semantic pinning is not implemented. Pause-and-resume behavior, memory pressure, sustained speed, heat, and Safari storage persistence still need validation on a physical iPhone 16; WebKit automation is not a hardware performance result.

If storage is unavailable, inference can still run, but the next load may download again. Dragging into the future remains a generation request until the text reaches that position, followed by the spare-word buffer. The tray shows `to cursor` and the remaining line count while catching up. A clearly labelled simulator is available before downloading; it is never substituted for model output automatically.

## Local static preview

```sh
npm ci
npm run build
python3 -m http.server 8090 --bind 127.0.0.1 --directory dist
```

Then open http://127.0.0.1:8090. This is a static file server, not an inference backend. The original native comparison path remains available through `/index.html?engine=native&local=true` with `native/server.py` running locally.

## Rebuild the WASM runtime

```sh
git clone https://github.com/emscripten-core/emsdk.git vendor/emsdk
vendor/emsdk/emsdk install 7.0.0
vendor/emsdk/emsdk activate 7.0.0
# Restore the pinned llama.cpp checkout and apply patches/attention-bias.patch.
# Download the model identified in public/runtime/manifest.json into models/.
bash scripts/build-browser-runtime.sh
npm run build
```

`native/browser/browser.cpp` implements model loading, exact-position tokenization, neutral prefill, live key biases, temperature/top-k/top-p sampling, repetition/frequency penalties, repeated four-token phrase blocking, sampler probabilities, and measured attention. Both models receive a fixed ChatML story-writing frame with an assistant story prefill. Steering still only changes pre-softmax attention bias; it does not rewrite the instruction frame. Hidden framing tokens have zero-width story spans so visible word offsets stay exact. `scripts/package-browser-runtime.mjs` hashes runtime artifacts and packages attribution. llama.cpp/ggml and nlohmann/json use MIT licences; Emscripten uses MIT/NCSA; both model weights use Apache-2.0.

## Verification and deployment

```sh
BROWSER_URL=http://127.0.0.1:8090 node tests/browser-story.mjs
ENGINE=webkit BROWSER_URL=http://127.0.0.1:8090 node tests/browser-story.mjs
npm run build
node scripts/package-vercel.mjs
vercel deploy --prebuilt --prod --scope bryanweecws-projects --yes
```

Browser checks load the real model, generate, create a touch lock, check portrait overflow, reopen the cached model, and compare neutral / zero-bias / steered next-token distributions and measured attention. They also assert no inference `/api` requests. Results are stored in `evidence/browser-story-*-check.json`. The deployed smoke check is separate from local verification and physical-device validation.

Desktop responsiveness: unchanged buffer refills reuse the existing browser model session and KV cache, including active fan controls. Bias is recalculated over retained keys so new occurrences of a fan-controlled word can receive attention bias without a new prefill. Rewinds and changed steering rebuild context. Neighboring display words around a lock do not invalidate its cache. The tray reports `preparing` with elapsed time before the first token, then `to cursor`, `generating`, `ready`, or `idle`. Generation errors stop automatic retries and remain visible. The runtime still uses single-threaded CPU WASM on desktop; it does not automatically select the native backend or GPU.

`node tests/source-lifecycle.mjs` covers session reuse and invalidation. `node tests/desktop-story.mjs` exercises real desktop inference with the pinned model, refill reuse, waiting feedback, and regeneration after a rewind. `MODEL_URL` can point to a locally served copy for repeatable checks without another download.

The story sampler excludes end-of-generation tokens so the raw story prefix keeps continuing; previously it could end after eight words and repeatedly retry the same ending. This is a sampling policy, separate from the attention bias. Rewind tracking now advances when streamed words become visible under a stationary knob, so dragging back across those words actually invalidates the future. Inference requests have a 120-second prefill / 30-second decode watchdog; a hung worker is terminated and the error asks for a reload.

`node tests/cursor-gestures.mjs` checks fast forward and back-forward gestures with the labelled simulator. `node tests/cursor-demand.mjs` checks a real-model fast drag to line 49, generation through the requested position and reserve, KV rollover without another prefill, retained opening positions, and normalized measured attention after each shift.

The semantic story canvas extends beyond the viewport and grows as the cursor advances. Swipe unboxed text or blank canvas to pan; touching a lock still drags it. Drag the main knob near a vertical edge to scroll through more canvas. Larger explicit hit targets, WebKit selection/callout CSS, targeted touch-start cancellation, and selection/context-menu suppression keep the hold fan gesture separate from native text selection. Desktop text selection remains available.

`node tests/mobile-canvas.mjs` verifies native touch swipes, expanded-target double-tap-and-hold, empty selection, suppressed context menu, edge scrolling and document growth in mobile Chromium. This is not a physical iPhone result. `tests/model-story.mjs` records real continuation samples, checks for repeated eight-word passages and quiz formatting, and optionally verifies cache rollover with the fixed framing. These are sample regressions, not a general quality guarantee.

## Composer prototype

Use **Start with your own prompt** before loading the model, or **compose** in the tray afterward. Choose **Start a new draft** for editable documentation, proposal, email, original-story or custom starters. Set the writing prompt and optionally paste opening text; leave the opening blank to generate from scratch. Starting replaces the canvas and clears its locks and fans.

Choose **Continue the current draft** to preserve text up to the cursor and its steering controls. Leave the new instruction empty to retain the original writing prompt; fill it to append direction for the next text only. Both paths discard the buffered future and generate a new continuation with real attention bias. New text begins at the cursor; earlier text stays as written. Instructions are kept separate from visible draft tokens and remain local to the worker.

Document mode preserves paragraphs, Markdown source and email line breaks on the canvas and in **copy draft**. Copy exports text up to the cursor, excluding the buffered future; if the clipboard is unavailable it downloads a plain `.txt` file. Drafts and writing instructions live in the tab and are not automatically saved. Copy before reloading. The prototype edits and exports plain text.

Document tasks may produce an end-of-generation token: generation then stops rather than retrying forever. Remaining buffered text can still be revealed. The tray shows **draft complete** once all generated text is visible. Story mode retains ongoing generation. The browser attention window is still bounded; long instructions receive a visible length error.

Validation: `node tests/composer-state.mjs` checks instruction retention/appending, limits, raw paragraphs and completion state. `node tests/composer-browser.mjs` uses real Qwen in mobile WebKit to start before model load, retain locks and committed text with both continuation paths, copy paragraphs and reset for a new draft. `node tests/composer-samples.mjs` records real documentation/proposal/email/blank-draft samples and verifies document attention changes. Sample outputs still require review for factual accuracy and instruction adherence. Physical iPhone testing remains separate.

Browser prompt preparation yields between 64-token decode batches and accepts cancellation messages. Changing prompts during preparation abandons the old request at the next batch boundary rather than finishing its entire prefill. A single in-flight batch still runs to completion.
