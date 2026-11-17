import { webkit } from "playwright-core"
import assert from "node:assert/strict"
import { readdir, writeFile } from "node:fs/promises"
import { WRITING_EXAMPLES } from "../src/text/composer/examples.ts"
const browser = await webkit.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.context().route("**/runtime/manifest.json", async (route) => {
    const manifest = await (await route.fetch()).json()
    manifest.models.find((m) => m.id === "qwen2.5-0.5b").url = "http://127.0.0.1:8090/test-qwen.gguf"
    await route.fulfill({ json: manifest })
  })
  await page.goto("http://127.0.0.1:8090/?sim=true")
  const file = (await readdir("dist/assets")).find((name) => name.startsWith("worker-") && name.endsWith(".js"))
  const samples = await page.evaluate(
    async ({ file, examples }) => {
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
      worker.onerror = (event) => {
        for (const p of pending.values()) p.reject(new Error(event.message))
      }
      const call = (op, body) =>
        new Promise((resolve, reject) => {
          pending.set(++id, { resolve, reject })
          worker.postMessage({ id, op, body })
        })
      await call("load", { model: "qwen2.5-0.5b" })
      const result = {}
      for (const [name, setup] of Object.entries(examples)) {
        const session = await call("init", { prompt: setup.opening, instruction: setup.instruction, kind: "document" })
        let text = setup.opening,
          done = false
        for (let i = 0; i < 80; i++) {
          const token = await call("step", { session: session.session, bias: [] })
          done = token.done
          if (done) break
          text += token.text
        }
        result[name] = { text, done, instruction: setup.instruction }
      }
      const prompt = examples.email.opening
      let session = await call("init", { prompt, instruction: examples.email.instruction, kind: "document" })
      const start = prompt.indexOf("Accessibility")
      const position = session.tokens.find((t) => t.start < start + 13 && t.end > start).position
      const neutral = await call("step", { session: session.session, bias: [] })
      session = await call("init", { prompt, instruction: examples.email.instruction, kind: "document" })
      const steered = await call("step", { session: session.session, bias: [{ position, value: 2 }] })
      worker.terminate()
      return { samples: result, neutral, steered, position }
    },
    {
      file,
      examples: {
        documentation: WRITING_EXAMPLES.documentation,
        proposal: WRITING_EXAMPLES.proposal,
        email: WRITING_EXAMPLES.email,
        custom: { instruction: "Write one short sentence thanking Sam for the helpful review. Output only the sentence.", opening: "" },
      },
    },
  )
  for (const [name, sample] of Object.entries(samples.samples)) {
    assert.ok(sample.text.length > 30)
    assert.doesNotMatch(sample.text, /Mira|spaceship|greenhouse/i)
    console.log(name, sample.text)
  }
  assert.equal(samples.samples.custom.done, true, "a finite custom task must be able to end naturally")
  assert.notDeepEqual(samples.neutral.top, samples.steered.top)
  assert.ok(samples.steered.attention[samples.position] > samples.neutral.attention[samples.position])
  await writeFile("evidence/composer-samples.json", JSON.stringify(samples, null, 2) + "\n")
  console.log("Real composer samples and document attention steering passed")
} finally {
  await browser.close()
}
