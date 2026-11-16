#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
revision=c7518dbec59281c430ca5278ab4e60eadbc88b13
if [ ! -d vendor/llama.cpp/.git ]; then
  mkdir -p vendor/llama.cpp
  git -C vendor/llama.cpp init
  git -C vendor/llama.cpp remote add origin https://github.com/ggml-org/llama.cpp.git
  git -C vendor/llama.cpp fetch --depth 1 origin "$revision"
  git -C vendor/llama.cpp checkout --detach FETCH_HEAD
fi
if [ "$(git -C vendor/llama.cpp rev-parse HEAD)" != "$revision" ]; then
  echo 'Unexpected llama.cpp revision; use a clean checkout at the pinned revision.' >&2
  exit 1
fi
if git -C vendor/llama.cpp apply --check ../../patches/attention-bias.patch 2>/dev/null; then
  git -C vendor/llama.cpp apply ../../patches/attention-bias.patch
elif ! git -C vendor/llama.cpp apply --reverse --check ../../patches/attention-bias.patch; then
  echo 'llama.cpp has incompatible local changes; preserving them.' >&2
  exit 1
fi
cmake -S native -B build -DGGML_METAL=OFF -DCMAKE_BUILD_TYPE=Release
cmake --build build --target attention-runner -j "${BUILD_JOBS:-4}"
npm ci
npm run build
mkdir -p models
model=models/qwen2.5-0.5b-instruct-q4_k_m.gguf
if [ "${DOWNLOAD_MODEL:-1}" = 1 ] && [ ! -f "$model" ]; then
  curl -L --fail --retry 2 -o "$model.part" https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf
  mv "$model.part" "$model"
fi
printf '\nStart with: python3 native/server.py --model %s\n' "$model"
