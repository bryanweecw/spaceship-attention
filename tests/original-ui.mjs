import { startRecording } from "../scripts/capture/recorder.mjs"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { chromium } from "playwright-core"
import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"

const record = process.argv.includes("--record")
let recording
let closing = false
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
})
await mkdir(".capture-local/original", { recursive: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = [],
    requests = [],
    responses = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("request", (request) => {
    if (request.url().endsWith("/api/init") || request.url().endsWith("/api/step"))
      requests.push({ path: new URL(request.url()).pathname, ...request.postDataJSON() })
  })
  page.on("response", async (response) => {
    if (!response.url().endsWith("/api/step") || !response.ok()) return
    try {
      responses.push(await response.json())
    } catch (error) {
      if (!closing) errors.push(error.message)
    }
  })
  await page.goto("http://127.0.0.1:8088")
  await page.waitForURL(/index.html\?local=true/)
  await page.waitForFunction(() => /\+\d{2,}/.test(document.querySelector("#status").textContent))
  assert.equal(await page.locator("#mode-toggle b").textContent(), "local")
  assert.equal(await page.locator("#prompt-form").count(), 0)
  const metrics = await page.locator("#text").evaluate((element) => {
    const rect = element.getBoundingClientRect(),
      style = getComputedStyle(element)
    return { left: rect.left, top: rect.top + parseFloat(style.paddingTop), width: rect.width, line: parseFloat(style.lineHeight), font: style.font }
  })
  async function knob() {
    return page.locator("#pointer").evaluate((element) => {
      const r = element.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
  }
  async function scrub(line, fraction = 0.9) {
    const point = await knob()
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    await page.mouse.move(metrics.left + metrics.width * fraction, metrics.top + metrics.line * (line + 0.5), { steps: 30 })
    await page.mouse.up()
    await page.waitForTimeout(600)
  }
  async function wordRect(word) {
    return page.locator("#text").evaluate((element, word) => {
      const node = element.firstChild,
        start = node.textContent.indexOf(word)
      if (start < 0) throw new Error("word not shown: " + word)
      const range = document.createRange()
      range.setStart(node, start)
      range.setEnd(node, start + word.length)
      return range.getBoundingClientRect().toJSON()
    }, word)
  }
  async function stage(text) {
    if (!record) return
    await page.locator("#recording-caption").evaluate((element, text) => {
      element.textContent = text
    }, text)
    await page.waitForTimeout(1800)
  }
  if (record) {
    await page.evaluate(() => {
      const caption = document.createElement("div")
      caption.id = "recording-caption"
      caption.style.cssText = "position:fixed;left:350px;top:550px;z-index:10000;color:#fff;background:#000;font:13px/1.5 monospace;pointer-events:none"
      document.body.append(caption)
    })
    recording = await startRecording(page, "original-spaceship", { x: 280, y: 0, width: 1000, height: 600 }, 2)
  }
  await stage("Original Spaceship UI + local llama.cpp. Drag the main knob to reveal text.")
  await scrub(7)
  await stage("Select ‘roses’: the existing attention box applies +2 to its exact model keys.")
  assert.match(await page.locator("#text").textContent(), /roses/)
  const rose = await wordRect("roses")
  await page.mouse.move(rose.x + 0.5, rose.y + rose.height / 2)
  await page.mouse.down()
  await page.mouse.move(rose.right - 0.5, rose.y + rose.height / 2, { steps: 12 })
  await page.mouse.up()
  await page.waitForFunction(() => (CSS.highlights.get("attention-word")?.size ?? 0) === 1)
  await page.waitForTimeout(1000)
  const roseRequest = requests.findLast((request) => request.path === "/api/step" && request.bias?.length)
  assert.ok(roseRequest, "text selection must send actual attention bias")
  assert.equal(roseRequest.bias[0].position, 10)
  assert.equal(roseRequest.bias[0].value, 2)
  await stage("Drag the shaded lock from ‘roses’ onto ‘engine’ to move its attention bias.")
  const engine = await wordRect("engine")
  const movedBias = page.waitForRequest(
    (request) => request.url().endsWith("/api/step") && request.postDataJSON().bias?.some((bias) => bias.position === 14 && bias.value === 2),
    { timeout: 30000 },
  )
  await page.mouse.move(rose.x + rose.width / 2, rose.y + rose.height / 2)
  await page.mouse.down()
  await page.mouse.move(engine.x + engine.width / 2, engine.y + engine.height / 2, { steps: 24 })
  await page.mouse.up()
  await movedBias
  await page.waitForTimeout(300)

  assert.ok(
    requests.some((request) => request.bias?.some((bias) => bias.position === 14 && bias.value === 2)),
    "dragged lock must move the weighted position",
  )
  await page.screenshot({ path: ".capture-local/original/attention-lock.png" })
  await stage("Double-click the main knob to release locks, then expand measured attention locks.")
  // The original double-click removes attached controls; another expands measured locks.
  let point = await knob()
  await page.mouse.dblclick(point.x, point.y, { delay: 80 })
  await page.waitForFunction(() => (CSS.highlights.get("attention-word")?.size ?? 0) === 0)
  await page.waitForTimeout(500)
  point = await knob()
  await page.mouse.dblclick(point.x, point.y, { delay: 80 })
  await page.waitForFunction(() => (CSS.highlights.get("attention-word")?.size ?? 0) === 3)
  await page.waitForTimeout(700)
  await stage("The original fan gesture now tunes a word’s attention: suppress / amplify.")
  // Double press and hold opens the upstream fan; drag out through a sector.
  point = await knob()
  await page.mouse.click(point.x, point.y)
  await page.waitForTimeout(100)
  await page.mouse.down()
  await page.waitForTimeout(700)
  await page.mouse.move(point.x + 90, point.y + 160, { steps: 30 })
  await page.waitForTimeout(600)
  await page.mouse.up()
  await page.waitForTimeout(1000)
  assert.equal(await page.locator(".future").count(), 1)
  const label = await page.locator(".future span").textContent()
  assert.match(label, /suppress|amplify|midway/)
  await page.screenshot({ path: ".capture-local/original/fan.png" })
  assert.ok(responses.some((response) => response.attention?.length > 30))
  assert.ok((await page.locator("#rail .meter [data-on]").count()) > 0, "measured rail must light")
  await stage("Angle sets signed bias; distance sets strength. The rail shows measured attention.")
  const before = requests.filter((r) => r.path === "/api/init").length
  await stage("Scrub backward to regenerate the future. The story prefix carries no added instructions.")
  await scrub(5)
  await page.waitForTimeout(1000)
  assert.ok(requests.filter((r) => r.path === "/api/init").length > before, "scrubbing back must regenerate")
  assert.ok(requests.filter((r) => r.path === "/api/init").every((r) => !/KEY PHRASES|CONTROLS|STORY SO FAR/.test(r.prompt)))
  assert.deepEqual(errors, [])
  await page.screenshot({ path: ".capture-local/original/final.png" })
  await writeFile(
    "evidence/original-ui-check.json",
    JSON.stringify(
      {
        interface: "original Spaceship canvas and controls",
        selection_bias_position: 10,
        dragged_bias_position: 14,
        bias: 2,
        auto_attention_boxes: 3,
        fan_label: label,
        measured_attention_layer: responses.find((r) => r.attention?.length)?.attention_layer,
        original_font: metrics.font,
        scrub_regeneration: true,
        added_steering_prompt: false,
        browser_errors: errors,
      },
      null,
      2,
    ) + "\n",
  )
  if (record) {
    await stage("Original canvas, locks, scrubber, fan and rail. Real local inference at actual speed.")
    const captured = await recording.stop()
    recording = undefined
    const list = resolve(captured.dir, "mp4-frames.txt")
    await writeFile(
      list,
      captured.frames.map(({ file, seconds }) => `file '${file}'\nduration ${Math.max(seconds, 0.001).toFixed(4)}`).join("\n") +
        `\nfile '${captured.frames.at(-1).file}'\n`,
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
        ".capture-local/original/spaceship-attention.mp4",
      ],
      { stdio: "inherit" },
    )
  }
  await page.locator("#mode-toggle").click()
  await page.waitForURL((url) => !url.searchParams.has("local"))
  await page.locator("#mode-toggle").click()
  await page.locator("#live-keys").waitFor({ state: "visible" })
  await page.getByRole("button", { name: "local llama.cpp", exact: true }).click()
  await page.waitForURL(/local=true/)
  assert.equal(await page.locator("#mode-toggle b").textContent(), "local")
  console.log("Original UI checks passed: selection, dragging locks, measured expansion/rail, fan control, scrubbing regeneration, no steering prompt.")
} finally {
  closing = true
  if (recording) await recording.stop()
  await browser.close()
}
