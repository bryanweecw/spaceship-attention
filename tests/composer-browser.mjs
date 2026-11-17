import { webkit } from "playwright-core"
import assert from "node:assert/strict"
import { writeFile, mkdir } from "node:fs/promises"
import { WRITING_EXAMPLES } from "../src/text/composer/examples.ts"
const browser = await webkit.launch({ headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 852, height: 393 }, hasTouch: true, isMobile: true })
  await context.route("**/runtime/manifest.json", async (route) => {
    const manifest = await (await route.fetch()).json()
    manifest.models.find((m) => m.id === "qwen2.5-0.5b").url = "http://127.0.0.1:8090/test-qwen.gguf"
    await route.fulfill({ json: manifest })
  })
  const page = await context.newPage()
  page.on("console", (m) => {
    if (m.text().startsWith("generation") || m.type() === "error") console.log(m.text())
  })
  const errors = []
  page.on("pageerror", (e) => errors.push(e.message))
  await page.addInitScript(() => {
    window.ops = []
    const Original = Worker
    window.Worker = class extends Original {
      postMessage(data) {
        window.ops.push(structuredClone(data))
        return super.postMessage(data)
      }
    }
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text) => {
          window.copied = text
        },
      },
    })
  })
  await page.goto("http://127.0.0.1:8090")
  await page.locator("#browser-compose").click()
  await page.locator("#composer-template").selectOption("proposal")
  assert.match(await page.locator("#composer-prompt").inputValue(), /two-week pilot/)
  await page.locator("#composer-template").selectOption("email")
  await page.locator("#composer-apply").click()
  assert.equal(await page.locator("#browser-start").evaluate((e) => e.open), true)
  await page.locator("#browser-load").click()
  await page.waitForFunction(() => window.ops.some((op) => op.op === "step"), null, { timeout: 180000 })
  const inits = () => page.evaluate(() => window.ops.filter((op) => op.op === "init"))
  let requests = await inits()
  assert.equal(requests.length, 1, "cancelled story must not prefill after selecting a draft before model load")
  assert.equal(requests[0].body.instruction, WRITING_EXAMPLES.email.instruction)
  assert.equal(requests[0].body.prompt, WRITING_EXAMPLES.email.opening)
  assert.equal(requests[0].body.kind, "document")
  await page.waitForFunction(() => window.ops.filter((op) => op.op === "step").length >= 15, null, { timeout: 120000 })
  const word = await page.locator("#text").evaluate((e) => {
    const start = e.firstChild.textContent.indexOf("Accessibility"),
      range = document.createRange()
    range.setStart(e.firstChild, start)
    range.setEnd(e.firstChild, start + 13)
    return range.getBoundingClientRect().toJSON()
  })
  await page.touchscreen.tap(word.x + word.width / 2, word.y + word.height / 2)
  await page.waitForFunction(() => window.ops.some((op) => op.op === "step" && op.body.bias.length > 0), null, { timeout: 120000 })
  requests = await inits()
  assert.equal(requests.at(-1).body.instruction, WRITING_EXAMPLES.email.instruction)
  const count = requests.length
  await page.locator("#compose-toggle").click()
  assert.equal(await page.locator('input[value="continue"]').isChecked(), true)
  const before = (await page.locator("#text").textContent()).replace(/\s+/g, " ").trim()
  await page.locator("#composer-apply").click()
  await page.waitForFunction((count) => window.ops.filter((op) => op.op === "init").length > count, count)
  requests = await inits()
  assert.equal(requests.at(-1).body.instruction, WRITING_EXAMPLES.email.instruction)
  assert.equal(requests.at(-1).body.prompt.replace(/\s+/g, " ").trim(), before)
  await page.locator("#compose-toggle").click()
  await page.locator("#composer-extra").fill("Next, offer Tuesday at 10am as a flexible meeting time.")
  await page.locator("#composer-apply").click()
  assert.equal(await page.locator("#composer").evaluate((e) => e.open), false, "editing a follow-up must not swallow its submit click")
  await page.waitForFunction(() => window.ops.some((op) => op.op === "init" && op.body.instruction.includes("Tuesday")), null, { timeout: 120000 })
  await page.waitForFunction(() => window.ops.at(-1).op === "step" && window.ops.at(-1).body.bias.length > 0, null, { timeout: 120000 })
  requests = await inits()
  assert.ok(requests.at(-1).body.instruction.startsWith(WRITING_EXAMPLES.email.instruction))
  assert.match(requests.at(-1).body.instruction, /Tuesday/)
  assert.ok((await page.evaluate(() => CSS.highlights.get("attention-word")?.size)) > 0, "new instruction retains locks")
  await page.locator("#copy-draft").click()
  assert.match(await page.evaluate(() => window.copied), /\n\nHi Sam,/)
  const copied = await page.evaluate(() => window.copied)
  await page.locator("#compose-toggle").click()
  await page.locator('input[value="start"]').check()
  await page.locator("#composer-template").selectOption("documentation")
  await page.setViewportSize({ width: 393, height: 852 })
  await mkdir(".capture-local/browser", { recursive: true })
  await page.screenshot({ path: ".capture-local/browser/composer-portrait.png" })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.locator("#composer-apply").click()
  await page.waitForFunction(() => window.ops.some((op) => op.op === "init" && op.body.instruction.includes("quick-start guide")), null, { timeout: 120000 })
  assert.equal(await page.evaluate(() => CSS.highlights.get("attention-word")?.size ?? 0), 0, "new draft clears old locks")
  assert.deepEqual(errors, [])
  await writeFile(
    "evidence/composer-browser-check.json",
    JSON.stringify(
      {
        backend: "real Qwen WASM in WebKit",
        start_before_model_load: true,
        steering_only_preserves_prompt: true,
        new_instruction_preserves_draft_and_locks: true,
        copied_paragraphs: copied,
        new_draft_clears_locks: true,
        portrait_overflow: false,
        errors,
        init_requests: await inits(),
      },
      null,
      2,
    ) + "\n",
  )
  console.log("Composer browser passed: start, steering only, added instruction, paragraphs, copy and new draft reset")
} finally {
  await browser.close()
}
