#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Install Emscripten 7.0.0 into vendor/emsdk first; see BROWSER_DEMO.md.
source vendor/emsdk/emsdk_env.sh >/dev/null 2>&1
emcmake cmake -S native/browser -B build/browser -DCMAKE_BUILD_TYPE=Release
cmake --build build/browser --target attention -j "${BUILD_JOBS:-4}"
node scripts/package-browser-runtime.mjs
