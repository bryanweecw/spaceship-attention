import { readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync, unlinkSync, statSync } from "node:fs"
import { createHash } from "node:crypto"
const directory = "public/runtime"
mkdirSync(directory, { recursive: true })
const hash = createHash("sha256").update(readFileSync("build/browser/runtime/attention.wasm")).digest("hex").slice(0, 16)
for (const file of readdirSync(directory)) if (/^attention-[a-f0-9]+\.(js|wasm)$/.test(file)) unlinkSync(`${directory}/${file}`)
for (const extension of ["js", "wasm"]) copyFileSync(`build/browser/runtime/attention.${extension}`, `${directory}/attention-${hash}.${extension}`)
const model = "models/SmolLM2-360M-Instruct-Q4_K_M.gguf"
const manifest = {
  module: `/runtime/attention-${hash}.js`,
  wasm: `/runtime/attention-${hash}.wasm`,
  llama_revision: "c7518dbec59281c430ca5278ab4e60eadbc88b13",
  emscripten: "7.0.0",
  backend: "WASM32 SIMD, one worker, no GPU required",
  model: {
    name: "SmolLM2 360M Instruct · Q4_K_M",
    url: "https://huggingface.co/bartowski/SmolLM2-360M-Instruct-GGUF/resolve/7be6f65f1db715fe5dc5a4634c0d459b4eed42ec/SmolLM2-360M-Instruct-Q4_K_M.gguf",
    bytes: statSync(model).size,
    sha256: createHash("sha256").update(readFileSync(model)).digest("hex"),
  },
}
writeFileSync(`${directory}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n")
copyFileSync("vendor/llama.cpp/LICENSE", `${directory}/LLAMA-LICENSE.txt`)
writeFileSync(
  `${directory}/NOTICE.txt`,
  "This browser runtime includes llama.cpp and ggml (MIT) and nlohmann/json (MIT).\nllama.cpp revision: " +
    manifest.llama_revision +
    "\nBuilt with Emscripten 7.0.0 (MIT / University of Illinois-NCSA).\nThe model weights are downloaded separately; SmolLM2 is Apache-2.0.\n\n" +
    readFileSync("vendor/llama.cpp/vendor/nlohmann/json.hpp", "utf8").split("#ifndef")[0].trimEnd() +
    "\n",
)
console.log(JSON.stringify({ runtime: hash, model_bytes: manifest.model.bytes }))
