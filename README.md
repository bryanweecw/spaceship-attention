# Spaceship Attention

An extension of [Spaceship IDE](https://github.com/chuanqisun/spaceship) by **Chuanqi Sun**, adding actual model-attention interventions and local inference to the original interactive writing canvas.

**Original work:** the canvas, attention-lock interaction, scrub knob, fan controls, rail, visual design and original prompting mechanisms belong to Spaceship IDE. This fork preserves that lineage and the upstream [MIT license](LICENSE) and [citation](CITATION.cff).

**This extension:** a patched llama.cpp runtime applies signed additive bias to attention scores before softmax and captures final-layer attention. Native GGUF inference and a browser WebAssembly worker connect those mechanisms to the existing controls. Browser model choices, editable writing prompts, continuation/cancellation handling and touch navigation support the demo. Measured attention is model telemetry, not a causal explanation of reasoning. Buffered text invalidation is not draft/target speculative decoding, and no decoding speedup is claimed.

[Try the browser demo](https://spaceship.bryanweecw.com) · [Browser setup and limitations](BROWSER_DEMO.md) · [Native setup](LOCAL_DEMO.md)

The browser downloads approximately 491 MB for Qwen2.5 0.5B, or 271 MB for SmolLM2 360M, then runs inference locally. Small model quality and latency vary by device. No server inference or shared API key is required for browser-model mode. Optional inherited cloud-provider modes send text to the provider when explicitly selected.

## Development

```sh
npm ci
npm run build
npm run dev
```

The checked-in WebAssembly runtime is distributed with llama.cpp and bundled dependency notices in `public/runtime/`. To rebuild it, see `scripts/build-browser-runtime.sh` and the pinned revision in the runtime manifest. Model weights are downloaded separately and retain their own Apache-2.0 terms. The native patch is `patches/attention-bias.patch`.

## Credits

Chuanqi Sun created the original Spaceship IDE interaction and implementation. Bryan Wee's fork adds the model-runtime experiments described above; it does not claim authorship of the original interface. See upstream's citation below. The project license retains the upstream copyright notice; bundled runtime notices must also be preserved.

---

Steer your ideas in realtime, space pilot style!

![Screencast](./extra/screencast.gif)

## Demos

Watch on [Instagram](https://www.instagram.com/reels/DfyQPhFtW-z/) and [YouTube](https://www.youtube.com/watch?v=3WmNLWUmcnY). You can try the simulator at [https://chuanqisun.github.io/spaceship/](https://chuanqisun.github.io/spaceship/) with the option to go live with your API keys for Cerebras and Gemini. Keys stay in your browser local storage. Do it at your own risk.

## Conjecture

> In the near future, LLM and Decision Models will reach 60 FPS interactivity.

When that happens, what new interaction paradigms will unlock? This project demonstrates plausible and desirable interactions for that future.

1. **Focus monitor**: can we visualize what LLM is paying attention to, and use that to guide human's focus towards what's important?

   ![focus monitor](./extra/clips/focus-monitor.gif)

2. **Attention lock**: can we force LLM to pay more attention to specific phrases so as to bias its future behavior?

   ![attention lock](./extra/clips/attention-lock.gif)

3. **Future Vector Steering**: can we decompose the task into eigenvectors, independently tune each, and re-compose them to influence the incoming text?

   ![future steering](./extra/clips/future-steering.gif)

4. **Realtime re-generation**: when text generation is cheap and fast, can we explore alternative futures by scrubbing?

   ![realtime regeneration](./extra/clips/realtime-regeneration.gif)

## Design process

I used Claude Code for most of the implementation but stayed hands-on for the UI/UX. I iterate using interactive style swatch, a technique where I prompt AI to give me diverse options of designs, I provide feedback, and it iterates. You can see the design artifacts in the [extra page](https://chuanqisun.github.io/spaceship/extra/style-1.html).

To achieve the realtime experience, I have to use agreesive speculative generation and manage cache invalidation based on user interactions. For example, when the main knob moves backward, I have to empty future texts and cancel ongoing requests. There are many considerations like this throughout the system and that took a lot of human judgement - claude didn't one shot them.

## Theory

I'm currently focusing on systems that help human shape ideas in realtime. This project is a small step towards my [upcoming thesis](https://code.chuanqisun.com/master-thesis/) at the MIT Media Lab, where I investigate how semantic and symoblic systems can be coupled to enhance human creativity, agency, and joy of craft.

## Citation

If you build on this work, please cite it as:

```bibtex
@misc{sun2026spaceship,
  author       = {Sun, Chuanqi},
  title        = {Spaceship {IDE}: Steer Your Ideas in Realtime, Space Pilot Style},
  year         = {2026},
  publisher    = {GitHub},
  howpublished = {\url{https://github.com/chuanqisun/spaceship}},
  note         = {Demo: \url{https://chuanqisun.github.io/spaceship/}}
}
```
