import { chromium } from "playwright-core"
import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"

const base = "http://127.0.0.1:8088"
await mkdir(".capture-local", { recursive: true })
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
})
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  const errors = []
  page.on("pageerror", (e) => errors.push(e.message))
  await page.goto(base)
  await page.getByText("llama.cpp / qwen", { exact: false }).waitFor()
  await page.getByRole("button", { name: "Load prompt", exact: true }).click()
  await page.getByText("Prompt loaded.", { exact: false }).waitFor()
  const token = page.locator("#tokens button").filter({ hasText: "roses" }).first()
  await token.click()
  await page.locator("#limit").fill("16")
  await page.getByRole("button", { name: "Compare baseline / steered", exact: true }).click()
  await page.getByText("Comparison complete.", { exact: false }).waitFor({ timeout: 60000 })
  assert.ok((await page.locator("#baseline").textContent()).length)
  assert.ok((await page.locator("#steered").textContent()).length)
  const comparison = await page.locator("#proof").textContent()
  assert.match(comparison, /Identical prompt/)
  await page.locator("#evidence").evaluate((e) => {
    e.open = true
  })
  const downloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download run JSON", exact: true }).click()
  const download = await downloadPromise
  await download.saveAs(".capture-local/browser-run.json")
  await page.screenshot({ path: ".capture-local/desktop.png", fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: ".capture-local/mobile.png", fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1000 })
  const sent = []
  page.on("request", (req) => {
    if (req.url().endsWith("/api/step")) sent.push(req.postDataJSON())
  })
  await page.locator("#limit").fill("48")
  await page.getByRole("button", { name: "Generate live", exact: true }).click()
  await page.waitForFunction(() => document.querySelector("#steered").textContent.length > 5)
  await page.locator("#weight").fill("-2")
  await page.waitForFunction(() => document.querySelector("#probability-caption").textContent.includes("weighted keys"))
  await page.waitForTimeout(400)
  await page.getByRole("button", { name: "Stop", exact: true }).click()
  await page.getByText("Stopped. Generate again", { exact: false }).waitFor({ timeout: 15000 })
  assert.ok(
    sent.some((r) => r.bias.some((b) => b.value === 2)),
    "initial bias sent",
  )
  assert.ok(
    sent.some((r) => r.bias.some((b) => b.value === -2)),
    "updated bias sent within the same session",
  )
  assert.equal(new Set(sent.map((r) => r.session)).size, 1)
  assert.deepEqual(errors, [])
  const originRejected = await page.request.post(base + "/api/init", { headers: { Origin: "https://example.com" }, data: { prompt: "Hello world" } })
  assert.equal(originRejected.status(), 403)
  const staleRejected = await page.request.post(base + "/api/step", { data: { session: "stale", bias: [] } })
  assert.equal(staleRejected.status(), 409)
  await writeFile(
    "evidence/browser-check.json",
    JSON.stringify(
      {
        comparison,
        live_bias_values: [...new Set(sent.flatMap((r) => r.bias.map((b) => b.value)))],
        live_session_count: 1,
        stop: "passed",
        horizontal_overflow_390px: false,
        browser_errors: errors,
        cross_origin_status: 403,
        stale_session_status: 409,
      },
      null,
      2,
    ) + "\n",
  )
  console.log("Browser checks passed: real A/B generation, JSON export, live bias change, stop, mobile overflow, session isolation, origin rejection.")
} finally {
  await browser.close()
}
