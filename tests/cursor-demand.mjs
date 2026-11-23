import { chromium, webkit } from "playwright-core"
import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
const engine = process.env.ENGINE ?? "chromium"
const browser = await (engine === "webkit"
  ? webkit.launch({ headless: true })
  : chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true }))
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1800 } })
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
          if (op) {
            op.ms = performance.now() - op.start
            if (data.result?.retained_positions)
              op.shift = {
                positions: data.result.retained_positions,
                attention_sum: data.result.attention.reduce((a, b) => a + b, 0),
                attention_count: data.result.attention.length,
              }
          }
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
    await page.mouse.move(target.x, target.y, { steps: 1 })
    await page.mouse.up()
  }
  await page.waitForFunction(() => window.operations.filter((op) => op.op === "step" && op.ms).length >= 10, null, { timeout: 900000 })
  const requestedLine = 96
  await dragTo(requestedLine)
  await page.mouse.move(50, 500)
  const timer = setInterval(
    async () => console.log(await page.locator("#status").textContent(), (await page.locator("#text").textContent()).split("\n").length),
    10000,
  )
  try {
    await page.waitForFunction(
      () => {
        const status = document.querySelector("#status")
        if (/context|failed|error|limit/i.test(status.textContent)) throw new Error(status.textContent)
        return !status.hasAttribute("data-streaming") && Number(status.querySelector("[data-field=words] small")?.textContent.slice(1)) >= 48
      },
      null,
      { timeout: 900000 },
    )
  } finally {
    clearInterval(timer)
  }
  const lines = (await page.locator("#text").textContent()).split("\n").length
  assert.equal(lines, requestedLine + 1, "generation must reach the requested cursor line before filling the reserve")
  const before = await page.locator("#text").textContent()
  assert.deepEqual(errors, [])
  await mkdir(".capture-local/browser", { recursive: true })
  await page.screenshot({ path: ".capture-local/browser/cursor-demand.png" })
  const operations = await page.evaluate(() => window.operations)
  const shifts = operations.filter((op) => op.shift)
  assert.ok(shifts.length > 0, "distant cursor must cross the original fixed context limit")
  assert.equal(operations.filter((op) => op.op === "init").length, 1, "context rollover must reuse cached keys instead of prefilling again")
  for (const { shift } of shifts) {
    assert.equal(shift.positions.length, shift.attention_count)
    assert.ok(Math.abs(shift.attention_sum - 1) < 0.0001)
    assert.deepEqual(
      shift.positions.slice(0, 64),
      Array.from({ length: 64 }, (_, i) => i),
    )
  }
  const evidence = {
    engine,
    host: page.url(),
    model_id: process.env.MODEL_ID ?? "qwen2.5-0.5b",
    waiting,
    errors,
    requested_line: requestedLine,
    reached_line: lines - 1,
    visible_text: before,
    shifts: shifts.length,
    operations,
  }
  await writeFile("evidence/cursor-demand-check.json", JSON.stringify(evidence, null, 2) + "\n")
  console.log(
    JSON.stringify({
      waiting,
      init_ms: operations.filter((op) => op.op === "init").map((op) => op.ms),
      shifts: shifts.length,
      reached_line: lines - 1,
      step_count: operations.filter((op) => op.op === "step").length,
      errors,
    }),
  )
} finally {
  await browser.close()
}
