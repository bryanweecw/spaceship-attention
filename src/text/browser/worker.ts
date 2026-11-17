import { loadModelFile, type ModelFileSystem } from "./model.ts"
type Runtime = { ccall(name: string, result: string, types: string[], values: string[]): string; FS: ModelFileSystem }
let runtime: Runtime
let session = ""
let preparing: number | undefined
const cancelled = new Set<number>()

self.onmessage = async ({ data: { id, op, body } }) => {
  if (op === "cancel") {
    if (preparing === id) cancelled.add(id)
    return
  }
  try {
    if (op === "load") {
      const manifest = await fetch("/runtime/manifest.json", { cache: "no-store" }).then((r) => r.json())
      const model = manifest.models.find((model: { id: string }) => model.id === (body?.model ?? manifest.default_model))
      if (!model) throw new Error("Choose an available browser model.")
      const { default: create } = await import(/* @vite-ignore */ manifest.module)
      runtime = await create({ locateFile: () => manifest.wasm, print: () => {}, printErr: () => {} })
      const cache = await loadModelFile(runtime.FS, model, (phase, received) => self.postMessage({ progress: { phase, received, total: model.bytes } }))
      self.postMessage({ progress: { phase: "Loading model into browser memory", received: model.bytes, total: model.bytes } })
      const result = call({ op: "load" })
      runtime.FS.unlink("/model.gguf")
      self.postMessage({ id, result: { ...result, ...cache, model: model.name } })
      return
    }
    if (!runtime) throw new Error("Load the browser model first.")
    if (op === "init") {
      if (preparing !== undefined) throw new Error("Wait for the current draft preparation to stop.")
      preparing = id
      const result = call({ op, prompt: body.prompt, instruction: body.instruction ?? "", kind: body.kind ?? "story" })
      for (;;) {
        if (cancelled.has(id)) throw new Error("Draft preparation cancelled.")
        if (call({ op: "prefill" }).ready) break
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      session = crypto.randomUUID()
      self.postMessage({ id, result: { ...result, session } })
    } else {
      if (body.session !== session) throw new Error("Story session changed. Reload to start again.")
      self.postMessage({ id, result: call({ op: "step", bias: body.bias ?? [] }) })
    }
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  } finally {
    cancelled.delete(id)
    if (preparing === id) preparing = undefined
  }
}

function call(body: unknown) {
  const result = JSON.parse(runtime.ccall("spaceship", "string", ["string"], [JSON.stringify(body)]))
  if (result.error) throw new Error(result.error)
  return result
}
