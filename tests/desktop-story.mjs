import { chromium } from "playwright-core"
import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  if (process.env.MODEL_URL)
    await page.context().route("**/runtime/manifest.json", async (route) => {
      const response = await route.fetch()
      const manifest = await response.json()
      manifest.models.find((model) => model.id === (process.env.MODEL_ID ?? "qwen2.5-0.5b")).url = process.env.MODEL_URL
      await route.fulfill({ json: manifest })
    })
  page.on("console", (message) => {
    if (message.text().startsWith("generation")) console.log(message.text())
  })
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.addInitScript(() => {
    window.operations = []
    const Original = window.Worker
    window.Worker = class extends Original {
      postMessage(data) {
        window.operations.push({ op: data.op, id: data.id, start: performance.now() })
        return super.postMessage(data)
      }
      constructor(...args) {
        super(...args)
        this.addEventListener("message", ({ data }) => {
          const op = window.operations.find((op) => op.id === data.id)
          if (op) op.ms = performance.now() - op.start
        })
      }
    }
  })
  await page.goto(process.env.BROWSER_URL ?? "http://127.0.0.1:8090")
  if (process.env.MODEL_ID) await page.locator("#browser-model").selectOption(process.env.MODEL_ID)
  await page.locator("#browser-load").click()
  await page.waitForFunction(() => !document.querySelector("#browser-start").open, null, { timeout: 240000 })
  await page.waitForFunction(() => document.querySelector("[data-field=activity]").textContent.includes("preparing"))
  const waiting = await page.locator("[data-field=activity]").textContent()
  async function dragTo(line) {
    const knob = await page.locator("#pointer").boundingBox()
    const target = await page.locator("#text").evaluate((e, line) => {
      const rect = e.getBoundingClientRect(),
        style = getComputedStyle(e)
      return { x: rect.x + rect.width - 5, y: rect.y + parseFloat(style.paddingTop) + (line + 0.5) * parseFloat(style.lineHeight) }
    }, line)
    await page.mouse.move(knob.x + knob.width / 2, knob.y + knob.height / 2)
    await page.mouse.down()
    await page.mouse.move(target.x, target.y, { steps: 15 })
    await page.mouse.up()
  }
  await page.waitForFunction(() => window.operations.filter((op) => op.op === "step" && op.ms).length >= 10, null, { timeout: 120000 })
  console.log("first tokens arrived")
  await dragTo(14)
  await page.waitForFunction(() => window.operations.filter((op) => op.op === "step" && op.ms).length >= 60, null, { timeout: 120000 })
  assert.equal(await page.evaluate(() => window.operations.filter((op) => op.op === "init").length), 1, "refills must not prefill again")
  console.log("refill completed without a second init")
  const before = await page.locator("#text").textContent()
  await dragTo(4)
  console.log("rewound", await page.locator("#status").textContent())
  await page.waitForFunction(() => window.operations.filter((op) => op.op === "init" && op.ms).length >= 2, null, { timeout: 120000 })
  const steps = await page.evaluate(() => window.operations.filter((op) => op.op === "step" && op.ms).length)
  await page.waitForFunction((steps) => window.operations.filter((op) => op.op === "step" && op.ms).length >= steps + 3, steps, { timeout: 120000 })
  await dragTo(10)
  assert.ok((await page.locator("#text").textContent()).length > 0)
  assert.deepEqual(errors, [])
  await mkdir(".capture-local/browser", { recursive: true })
  await page.screenshot({ path: ".capture-local/browser/desktop-progress.png" })
  const operations = await page.evaluate(() => window.operations)
  const evidence = { host: page.url(), waiting, errors, before_rewind: before, operations }
  await writeFile("evidence/desktop-story-check.json", JSON.stringify(evidence, null, 2) + "\n")
  console.log(
    JSON.stringify({
      waiting,
      init_ms: operations.filter((op) => op.op === "init").map((op) => op.ms),
      step_count: operations.filter((op) => op.op === "step").length,
      errors,
    }),
  )
} finally {
  await browser.close()
}
