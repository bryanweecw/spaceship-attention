import { chromium } from "playwright-core"
import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 852, height: 393 }, hasTouch: true, isMobile: true })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto("http://127.0.0.1:8090/?sim=true")
  await page.waitForFunction(() => document.querySelector("[data-field=activity]").textContent === "ready")
  const cdp = await context.newCDPSession(page)
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 0 }] })
  const knobCenter = () =>
    page.locator("#pointer").evaluate((e) => {
      const r = e.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
  let knob = await knobCenter()
  await touch("touchStart", knob.x, knob.y)
  await touch("touchMove", 600, 240)
  await page.waitForTimeout(120)
  await touch("touchEnd")
  await page.waitForTimeout(200)
  await page.evaluate(() => scrollTo(0, 0))
  knob = await knobCenter()
  // Tap the outer target, outside the original 14px face, then hold its second tap.
  const x = knob.x + 12,
    y = knob.y
  await touch("touchStart", x, y)
  await touch("touchEnd")
  await page.waitForTimeout(100)
  await touch("touchStart", x, y)
  await page.waitForTimeout(650)
  assert.ok(await page.locator(".future").count(), "double-tap hold opens a fan from the expanded target")
  assert.equal(await page.evaluate(() => getSelection()?.toString()), "")
  const suppressed = await page.locator("#pointer .touch-target").evaluate((e) => {
    const event = new Event("contextmenu", { bubbles: true, cancelable: true })
    e.dispatchEvent(event)
    return event.defaultPrevented
  })
  assert.equal(suppressed, true)
  await touch("touchEnd")
  await page.waitForTimeout(150)
  // A normal canvas swipe scrolls, without dragging the main knob.
  await touch("touchStart", 750, 290)
  for (let i = 1; i <= 12; i++) {
    await touch("touchMove", 750, 290 - i * 15)
    await page.waitForTimeout(20)
  }
  await touch("touchEnd")
  await page.waitForTimeout(400)
  assert.ok((await page.evaluate(() => scrollY)) > 50, "canvas supports native touch scrolling")
  await page.evaluate(() => scrollTo(0, 0))
  await page.waitForTimeout(100)
  knob = await knobCenter()
  const before = await page.locator("#canvas").evaluate((e) => e.scrollHeight)
  await touch("touchStart", knob.x, knob.y)
  await touch("touchMove", 600, 335)
  await page.waitForTimeout(1800)
  const scrolled = await page.evaluate(() => scrollY)
  await touch("touchEnd")
  assert.ok(scrolled > 200, "held knob scrolls at the bottom edge")
  const after = await page.locator("#canvas").evaluate((e) => e.scrollHeight)
  assert.ok(after > before, "canvas extends as the cursor advances")
  await page.setViewportSize({ width: 393, height: 852 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  assert.deepEqual(errors, [])
  await mkdir(".capture-local/browser", { recursive: true })
  await page.screenshot({ path: ".capture-local/browser/mobile-scroll.png", fullPage: true })
  await writeFile(
    "evidence/mobile-canvas-check.json",
    JSON.stringify(
      {
        simulator: true,
        native_touch_scroll: true,
        expanded_target_hold: true,
        no_selection: true,
        suppressed_contextmenu: true,
        edge_scroll_pixels: scrolled,
        extent_before: before,
        extent_after: after,
        errors,
      },
      null,
      2,
    ) + "\n",
  )
  console.log("Mobile canvas passed: hold fan, no selection, native swipe, edge scroll and growing document")
} finally {
  await browser.close()
}
