import { readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs"
import { createHash } from "node:crypto"
import { BROWSER_MODELS, DEFAULT_MODEL } from "../src/text/browser/models.ts"
const directory = "public/runtime"
mkdirSync(directory, { recursive: true })
const hash = createHash("sha256").update(readFileSync("build/browser/runtime/attention.wasm")).digest("hex").slice(0, 16)
for (const file of readdirSync(directory)) if (/^attention-[a-f0-9]+\.(js|wasm)$/.test(file)) unlinkSync(`${directory}/${file}`)
for (const extension of ["js", "wasm"]) copyFileSync(`build/browser/runtime/attention.${extension}`, `${directory}/attention-${hash}.${extension}`)
const manifest = {
  module: `/runtime/attention-${hash}.js`,
  wasm: `/runtime/attention-${hash}.wasm`,
  llama_revision: "c7518dbec59281c430ca5278ab4e60eadbc88b13",
  emscripten: "7.0.0",
  backend: "WASM32 SIMD, one worker, no GPU required",
  default_model: DEFAULT_MODEL,
  models: BROWSER_MODELS,
}
writeFileSync(`${directory}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n")
copyFileSync("vendor/llama.cpp/LICENSE", `${directory}/LLAMA-LICENSE.txt`)
writeFileSync(
  `${directory}/NOTICE.txt`,
  "This browser runtime includes llama.cpp and ggml (MIT) and nlohmann/json (MIT).\nllama.cpp revision: " +
    manifest.llama_revision +
    "\nBuilt with Emscripten 7.0.0 (MIT / University of Illinois-NCSA).\nThe model weights are downloaded separately; Qwen2.5 and SmolLM2 are Apache-2.0.\n\n" +
    readFileSync("vendor/llama.cpp/vendor/nlohmann/json.hpp", "utf8").split("#ifndef")[0].trimEnd() +
    "\n",
)
console.log(JSON.stringify({ runtime: hash, models: manifest.models.map(({ id, bytes }) => ({ id, bytes })) }))
