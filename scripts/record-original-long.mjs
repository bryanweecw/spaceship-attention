import { chromium } from "playwright-core"
import { createHand } from "./capture/hand.mjs"
import { execFileSync } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import assert from "node:assert/strict"

const folder = resolve(".capture-local/long-demo")
await mkdir(folder, { recursive: true })
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true })
let recording = false,
  stopped,
  closing = false
const frames = [],
  requests = [],
  errors = [],
  chapters = []
let started
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const hand = createHand(page)
  page.on("pageerror", (e) => errors.push(e.message))
  page.on("request", (req) => {
    if (req.url().endsWith("/api/step") || req.url().endsWith("/api/init"))
      requests.push({ at: performance.now(), path: new URL(req.url()).pathname, ...req.postDataJSON() })
  })
  await page.goto("http://127.0.0.1:8088")
  await page.waitForURL(/local=true/)
  await page.waitForFunction(() => /\+\d{2,}/.test(document.querySelector("#status").textContent))
  await page.evaluate(() => {
    const caption = document.createElement("div")
    caption.id = "recording-caption"
    caption.style.cssText =
      "position:fixed;left:330px;top:545px;width:870px;color:#fff;background:#000;font:13px/1.5 monospace;z-index:10000;pointer-events:none"
    document.body.append(caption)
  })
  const m = await page.locator("#text").evaluate((e) => {
    const r = e.getBoundingClientRect(),
      s = getComputedStyle(e)
    return { left: r.left, top: r.top + parseFloat(s.paddingTop), width: r.width, line: parseFloat(s.lineHeight) }
  })
  const center = (locator) =>
    locator.evaluate((e) => {
      const r = e.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
  const main = () => center(page.locator("#pointer"))
  const pause = (ms) => page.waitForTimeout(ms)
  async function stage(text) {
    chapters.push({ seconds: (performance.now() - started) / 1000, text })
    await page.locator("#recording-caption").evaluate((e, t) => {
      e.textContent = t
    }, text)
    await pause(1600)
  }
  async function scrub(line, fraction = 0.9) {
    await hand.moveTo(await main(), { ms: 650 })
    await hand.drag({ x: m.left + m.width * fraction, y: m.top + m.line * (line + 0.5) }, { ms: 1900, arc: 0 })
    await pause(1600)
  }
  async function word(word) {
    return page.locator("#text").evaluate((e, word) => {
      const node = e.firstChild,
        start = node.textContent.indexOf(word)
      if (start < 0) throw new Error("Not shown: " + word)
      const range = document.createRange()
      range.setStart(node, start)
      range.setEnd(node, start + word.length)
      return range.getBoundingClientRect().toJSON()
    }, word)
  }
  async function select(wordText) {
    const r = await word(wordText)
    await hand.moveTo({ x: r.x + 0.5, y: r.y + r.height / 2 }, { ms: 700 })
    await hand.drag({ x: r.right - 0.5, y: r.y + r.height / 2 }, { ms: 900, arc: 0 })
    await pause(1600)
  }
  const cdp = await page.context().newCDPSession(page)
  recording = true
  started = performance.now()
  stopped = (async () => {
    while (recording) {
      const at = performance.now()
      const { data } = await cdp.send("Page.captureScreenshot", {
        format: "png",
        clip: { x: 280, y: 0, width: 1000, height: 600, scale: 2 },
        optimizeForSpeed: true,
      })
      const file = resolve(folder, `${String(frames.length).padStart(5, "0")}.png`)
      await writeFile(file, Buffer.from(data, "base64"))
      frames.push({ file, at })
      await new Promise((r) => setTimeout(r, Math.max(0, 100 - (performance.now() - at))))
    }
  })()
  await stage("Spaceship’s original interface. Local Qwen2.5 through llama.cpp. Actual-speed recording.")
  await pause(3500)
  await stage("Drag the main knob forward: first the opening, then the generated continuation.")
  await scrub(3)
  await pause(3000)
  await scrub(7)
  await pause(5000)
  await stage("Select “roses”. Its attention lock adds +2 to the selected word’s model keys.")
  await select("roses")
  assert.ok(requests.some((r) => r.bias?.some((b) => b.position === 10 && b.value === 2)))
  await pause(4500)
  await stage("Reveal more of the regenerated future. The lock stays attached as the cursor moves.")
  await scrub(9)
  await pause(5500)
  await stage("Move the lock onto “engine”. Dragging changes the actual weighted key positions.")
  const rose = await word("roses"),
    engine = await word("engine")
  const moved = page.waitForRequest((r) => r.url().endsWith("/api/step") && r.postDataJSON().bias?.some((b) => b.position === 14 && b.value === 2), {
    timeout: 30000,
  })
  await hand.moveTo({ x: rose.x + rose.width / 2, y: rose.y + rose.height / 2 }, { ms: 900 })
  await hand.drag({ x: engine.x + engine.width / 2, y: engine.y + engine.height / 2 }, { ms: 1700, arc: 0 })
  await moved
  await pause(4500)
  await stage("Double-click the main knob to release locks. Double-click again to discover measured attention.")
  await hand.moveTo(await main(), { ms: 850 })
  await hand.doubleClick()
  await pause(2100)
  await hand.moveTo(await main(), { ms: 400 })
  await hand.doubleClick()
  await page.waitForFunction(() => (CSS.highlights.get("attention-word")?.size ?? 0) === 3)
  await pause(3500)
  await stage("Hover the locks and inspect the left rail: final-layer attention averaged across heads.")
  const boxes = await page.evaluate(() => [...CSS.highlights.get("attention-word")].map((r) => r.getBoundingClientRect().toJSON()))
  for (const r of boxes) {
    await hand.moveTo({ x: r.x + r.width / 2, y: r.y + r.height / 2 }, { ms: 650 })
    await pause(1500)
  }
  await stage("Double-click and hold the main knob, then pull out a fan control.")
  const origin = await main()
  await hand.moveTo(origin, { ms: 850 })
  await hand.click()
  await pause(100)
  await hand.press()
  await pause(700)
  await hand.moveTo({ x: origin.x + 90, y: origin.y + 160 }, { ms: 1800, arc: 0 })
  await pause(2500)
  await hand.release()
  await pause(2200)
  assert.equal(await page.locator(".future").count(), 1)
  await stage("The fan names a story word. Turn left to suppress attention to that word.")
  await hand.moveTo(await center(page.locator(".future")), { ms: 650 })
  await hand.press()
  await hand.moveTo({ x: origin.x - 160, y: origin.y + 115 }, { ms: 2100, arc: 0 })
  await pause(2500)
  await hand.release()
  await pause(2500)
  assert.match(await page.locator(".future span").textContent(), /suppress/)
  await stage("Bring the control closer: distance reduces the strength of the intervention.")
  await hand.moveTo(await center(page.locator(".future")), { ms: 600 })
  await hand.press()
  await hand.moveTo({ x: origin.x - 65, y: origin.y + 65 }, { ms: 1700, arc: 0 })
  await pause(2500)
  await hand.release()
  await pause(2200)
  await stage("Now turn right and move outward: amplify the same word more strongly.")
  await hand.moveTo(await center(page.locator(".future")), { ms: 600 })
  await hand.press()
  await hand.moveTo({ x: origin.x + 160, y: origin.y + 115 }, { ms: 2200, arc: 0 })
  await pause(2500)
  await hand.release()
  await pause(2500)
  assert.match(await page.locator(".future span").textContent(), /amplify/)
  await stage("Scrub backward and rest. Spaceship discards the buffered future and generates a new branch.")
  const before = requests.filter((r) => r.path === "/api/init").length
  await scrub(5)
  await pause(4000)
  assert.ok(requests.filter((r) => r.path === "/api/init").length > before)
  await stage("Move forward again to read the new continuation under the current attention settings.")
  await scrub(9)
  await pause(5000)
  await stage("Release all attached controls, then explore another continuation with the original scrubber.")
  await hand.moveTo(await main(), { ms: 700 })
  await hand.doubleClick()
  await pause(2000)
  await scrub(6)
  await pause(2500)
  await scrub(10)
  await pause(4500)
  await stage("Same Spaceship UI. Real attention bias and measured attention. No added steering instructions.")
  await hand.moveTo({ x: 1180, y: 475 }, { ms: 900 })
  await pause(4000)
  assert.deepEqual(errors, [])
  assert.ok(requests.filter((r) => r.path === "/api/init").every((r) => !/KEY PHRASES|CONTROLS|STORY SO FAR/.test(r.prompt)))
  assert.ok(requests.some((r) => r.bias?.some((b) => b.value < 0)))
  assert.ok(requests.some((r) => r.bias?.some((b) => b.value > 2)))
  await page.screenshot({ path: resolve(folder, "final.png"), clip: { x: 280, y: 0, width: 1000, height: 600 } })
  recording = false
  await stopped
  const ended = performance.now()
  await writeFile(resolve(folder, "chapters.json"), JSON.stringify(chapters, null, 2) + "\n")
  await writeFile(
    resolve(folder, "verification.json"),
    JSON.stringify(
      {
        browser_errors: errors,
        actual_speed: true,
        selection_position: 10,
        drag_position: 14,
        suppression: true,
        amplification: true,
        scrub_regeneration: true,
        added_steering_instructions: false,
        request_count: requests.length,
      },
      null,
      2,
    ) + "\n",
  )
  const list = resolve(folder, "frames.txt")
  await writeFile(
    list,
    frames.map((f, i) => `file '${f.file}'\nduration ${((frames[i + 1]?.at ?? ended) - f.at) / 1000}`).join("\n") + `\nfile '${frames.at(-1).file}'\n`,
  )
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      list,
      "-vf",
      "fps=30",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "19",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      resolve(folder, "spaceship-long-demo.mp4"),
    ],
    { stdio: "inherit" },
  )
  console.log(JSON.stringify({ video: resolve(folder, "spaceship-long-demo.mp4"), seconds: (ended - started) / 1000, frames: frames.length }))
} finally {
  recording = false
  if (stopped) await stopped
  closing = true
  await browser.close()
}
