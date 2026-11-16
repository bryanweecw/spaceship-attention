# Story attention checkpoint

The original Spaceship UI with local llama.cpp attention steering is preserved on branch `checkpoint/story-attention-20261117`. Its implementation base is `747d6c6`.

This checkpoint includes the previously untracked diagnostic recorder, the longer original-interface recorder, both original-UI MP4 demos, and the long recording's chapters and verification. See `LOCAL_DEMO.md` for setup and `evidence/` for the completed model/browser checks.

Model weights, local builds, vendored llama.cpp, raw recording frames, caches, and credentials remain local and ignored. The tested model's checksum is in `evidence/model.sha256`; the pinned llama.cpp revision and patch are reproducible through `scripts/setup-local.sh`.

The code-generation experiment starts from this checkpoint on `demo/code-generation`; it does not replace the story checkpoint or change `main`.
