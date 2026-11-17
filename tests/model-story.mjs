import { webkit } from "playwright-core"
import assert from "node:assert/strict"
import { readdir, writeFile } from "node:fs/promises"
const browser = await webkit.launch({ headless: true })
try {
  const page = await browser.newPage()
  const modelId = process.env.MODEL_ID ?? "qwen2.5-0.5b"
  if (process.env.MODEL_URL)
    await page.context().route("**/runtime/manifest.json", async (route) => {
      const manifest = await (await route.fetch()).json()
      manifest.models.find((m) => m.id === modelId).url = process.env.MODEL_URL
      await route.fulfill({ json: manifest })
    })
  await page.goto("http://127.0.0.1:8090/?sim=true")
  const workerFile = (await readdir("dist/assets")).find((name) => name.startsWith("worker-") && name.endsWith(".js"))
  const evidence = await page.evaluate(
    async ({ modelId, workerFile, rollover }) => {
      const worker = new Worker(`/assets/${workerFile}`, { type: "module" })
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
      const loaded = await call("load", { model: modelId })
      const opening =
        "The spaceship carried two things: a greenhouse full of roses and a damaged engine. Mira loved the garden, but the mechanic worried about the reactor. When she opened the hatch, she found"
      let session = await call("init", { prompt: opening })
      let text = ""
      for (let i = 0; i < 160; i++) {
        const result = await call("step", { session: session.session, bias: [] })
        text += result.text
      }
      let shifted
      if (rollover) {
        const longPrompt =
          opening +
          " a sealed map. " +
          "Mira mapped the distant stars while the crew repaired their ship and tended the roses. ".repeat(70) +
          "That night, a signal arrived from the dark planet. She"
        session = await call("init", { prompt: longPrompt })
        for (let i = 0; i < 270; i++) {
          const result = await call("step", { session: session.session, bias: [] })
          if (result.retained_positions)
            shifted = {
              positions: result.retained_positions,
              sum: result.attention.reduce((a, b) => a + b, 0),
              opening: session.opening_tokens,
              total_prompt_tokens: session.total_prompt_tokens,
              prompt_tokens: session.prompt_tokens,
            }
        }
      }
      worker.terminate()
      return { modelId, loaded, opening, generated: text, shifted }
    },
    { modelId, workerFile, rollover: process.env.ROLLOVER === "true" },
  )
  assert.ok(evidence.generated.length > 200)
  assert.doesNotMatch(evidence.generated, /(?:Question|Options|Answer):/)
  const words = evidence.generated.toLowerCase().match(/[a-z]+/g)
  const grams = words.slice(7).map((_, i) => words.slice(i, i + 8).join(" "))
  assert.equal(new Set(grams).size, grams.length, "story sample must not repeat eight-word passages")
  if (process.env.ROLLOVER === "true") {
    assert.ok(evidence.shifted)
    assert.ok(Math.abs(evidence.shifted.sum - 1) < 0.0001)
    assert.deepEqual(
      evidence.shifted.positions.slice(0, evidence.shifted.opening),
      Array.from({ length: evidence.shifted.opening }, (_, i) => i),
    )
  }
  await writeFile(`evidence/story-quality-${modelId}.json`, JSON.stringify(evidence, null, 2) + "\n")
  console.log(modelId, evidence.generated, evidence.shifted ? "rollover passed" : "")
} finally {
  await browser.close()
}
