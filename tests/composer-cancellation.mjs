import { webkit } from "playwright-core"
import assert from "node:assert/strict"
import { readdir, writeFile } from "node:fs/promises"
const browser = await webkit.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.context().route("**/runtime/manifest.json", async (route) => {
    const m = await (await route.fetch()).json()
    m.models[0].url = "http://127.0.0.1:8090/test-qwen.gguf"
    await route.fulfill({ json: m })
  })
  await page.goto("http://127.0.0.1:8090/?sim=true")
  const file = (await readdir("dist/assets")).find((n) => n.startsWith("worker-") && n.endsWith(".js"))
  const result = await page.evaluate(async (file) => {
    const worker = new Worker(`/assets/${file}`, { type: "module" })
    const pending = new Map()
    let id = 0
    worker.onmessage = ({ data }) => {
      if (!data.id) return
      const p = pending.get(data.id)
      pending.delete(data.id)
      if (data.error) p.reject(new Error(data.error))
      else p.resolve(data.result)
    }
    const call = (op, body) =>
      new Promise((resolve, reject) => {
        pending.set(++id, { resolve, reject })
        worker.postMessage({ id, op, body })
      })
    await call("load", { model: "qwen2.5-0.5b" })
    const started = performance.now()
    const abandoned = call("init", { kind: "document", instruction: "Continue this guide.", prompt: "A detailed guide. ".repeat(600) })
    worker.postMessage({ id, op: "cancel" })
    const cancellation = await abandoned.then(
      () => "unexpected completion",
      (e) => e.message,
    )
    const cancelledMs = performance.now() - started
    const session = await call("init", { kind: "document", instruction: "Write a short thank-you sentence to Sam.", prompt: "Thank you" })
    const next = await call("step", { session: session.session, bias: [] })
    worker.terminate()
    return { cancellation, cancelledMs, next, session_tokens: session.prompt_tokens }
  }, file)
  assert.match(result.cancellation, /cancelled/i)
  assert.ok(result.next.text.length > 0 || result.next.done)
  await writeFile("evidence/composer-cancellation-check.json", JSON.stringify(result, null, 2) + "\n")
  console.log("Prefill cancellation and recovery passed", result.cancelledMs)
} finally {
  await browser.close()
}
