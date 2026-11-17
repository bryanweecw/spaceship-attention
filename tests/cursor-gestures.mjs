import { chromium } from "playwright-core"
import assert from "node:assert/strict"
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1800 } })
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto("http://127.0.0.1:8090/?sim=true")
  await page.waitForFunction(() => document.querySelector("[data-field=activity]").textContent === "ready")
  const point = async (line) =>
    page.locator("#text").evaluate((e, line) => {
      const rect = e.getBoundingClientRect(),
        style = getComputedStyle(e)
      return { x: rect.right - 5, y: rect.top + parseFloat(style.paddingTop) + (line + 0.5) * parseFloat(style.lineHeight) }
    }, line)
  const target = await point(55)
  async function grab() {
    const knob = await page.locator("#pointer").boundingBox()
    await page.mouse.move(knob.x + knob.width / 2, knob.y + knob.height / 2)
    await page.mouse.down()
  }
  async function reached() {
    await page.waitForFunction(
      () =>
        !document.querySelector("#status").hasAttribute("data-streaming") &&
        Number(document.querySelector("[data-field=words] small").textContent.slice(1)) >= 48,
      null,
      { timeout: 15000 },
    )
    assert.equal((await page.locator("#text").textContent()).split("\n").length, 56)
  }
  await grab()
  await page.mouse.move(target.x, target.y)
  await page.mouse.up()
  await reached()
  await grab()
  const back = await point(4)
  await page.mouse.move(back.x, back.y)
  await page.mouse.move(target.x, target.y)
  await page.mouse.up()
  await reached()
  assert.deepEqual(errors, [])
  console.log("Cursor gesture checks passed: fast forward and fast back-forward both fill through the requested line and reserve")
} finally {
  await browser.close()
}
