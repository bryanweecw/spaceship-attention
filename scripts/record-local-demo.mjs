import { chromium } from "playwright-core"
import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import assert from "node:assert/strict"
import { startRecording } from "./capture/recorder.mjs"

const output = resolve(".capture-local/demo")
mkdirSync(output, { recursive: true })
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
})
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1 })
  const errors = []
  const steps = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("request", (request) => {
    if (request.url().endsWith("/api/step")) steps.push(request.postDataJSON())
  })
  await page.goto(process.env.APP_URL ?? "http://127.0.0.1:8088")
  await page.getByText("llama.cpp / qwen", { exact: false }).waitFor()
  await page.evaluate(async () => {
    await document.fonts.ready
    const caption = document.createElement("div")
    caption.id = "recording-caption"
    caption.style.cssText =
      "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:10000;background:#000;color:#fff;border:1px solid #aaa;padding:12px 20px;font:16px/1.5 monospace;max-width:95vw;white-space:nowrap;pointer-events:none"
    document.body.append(caption)
    const cursor = document.createElement("div")
    cursor.style.cssText =
      "position:fixed;left:-30px;top:-30px;width:18px;height:18px;border:2px solid white;border-radius:50%;background:#ff963b88;z-index:10001;pointer-events:none;transform:translate(-50%,-50%)"
    document.body.append(cursor)
    document.addEventListener("mousemove", (event) => {
      cursor.style.left = `${event.clientX}px`
      cursor.style.top = `${event.clientY}px`
    })
    document.addEventListener("mousedown", () => {
      cursor.style.background = "#fff"
    })
    document.addEventListener("mouseup", () => {
      cursor.style.background = "#ff963b88"
    })
  })
  const caption = async (text) =>
    page.locator("#recording-caption").evaluate((element, text) => {
      element.textContent = text
    }, text)
  const pause = (ms) => page.waitForTimeout(ms)
  const click = async (locator) => {
    await locator.scrollIntoViewIfNeeded()
    const rect = await locator.boundingBox()
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2, { steps: 18 })
    await pause(250)
    await page.mouse.down()
    await pause(120)
    await page.mouse.up()
  }
  await caption("Local Qwen2.5 + llama.cpp • Real attention steering • Recorded at actual speed")
  const recording = await startRecording(page, "local-attention-demo", { x: 0, y: 0, width: 1440, height: 1080 }, 1)
  let captured
  try {
    await pause(2200)
    await caption("1. Load the story. The prompt stays the same for both paths.")
    await click(page.getByRole("button", { name: "Load prompt", exact: true }))
    await page.getByText("Prompt loaded.", { exact: false }).waitFor()
    await pause(1000)
    await caption("2. Lock attention onto ‘roses’ with a +2 pre-softmax bias.")
    await click(page.locator("#tokens button").filter({ hasText: "roses" }).first())
    await page.locator("#limit").fill("16")
    await pause(2000)
    await caption("3. Compare identical prompts and greedy decoding. Only attention weights differ.")
    await click(page.getByRole("button", { name: "Compare baseline / steered", exact: true }))
    await page.getByText("Comparison complete.", { exact: false }).waitFor({ timeout: 60000 })
    await pause(1600)
    await caption("Baseline: ‘greenhouse was empty’ → Steered: ‘roses were all dead’")
    assert.match(await page.locator("#baseline").textContent(), /greenhouse was empty/)
    assert.match(await page.locator("#steered").textContent(), /roses were all dead/)
    await page.screenshot({ path: resolve(output, "comparison.png") })
    await pause(4500)
    await caption("4. Inspect the actual next-token probabilities and export the run.")
    await click(page.locator("#evidence summary"))
    await page.locator("#evidence").scrollIntoViewIfNeeded()
    await pause(3500)
    const downloadPromise = page.waitForEvent("download")
    await click(page.getByRole("button", { name: "Download run JSON", exact: true }))
    await (await downloadPromise).saveAs(resolve(output, "comparison-run.json"))
    await pause(1000)
    await page.evaluate(() => window.scrollTo({ top: 310, behavior: "smooth" }))
    await pause(700)
    await caption("5. Generate live, then turn the selected key’s bias from +2 to −2.")
    await page.locator("#limit").fill("256")
    const liveStart = steps.length
    await click(page.getByRole("button", { name: "Generate live", exact: true }))
    await page.waitForFunction(() => document.querySelector("#steered").textContent.length > 8)
    await page.locator("#weight").fill("-2")
    await caption("The next decode uses −2. No reprompting; the existing KV cache continues.")
    await page.waitForFunction(() => document.querySelector("#steered").textContent.length > 55)
    await pause(600)
    if (await page.getByRole("button", { name: "Stop", exact: true }).isEnabled()) {
      await click(page.getByRole("button", { name: "Stop", exact: true }))
    }
    await page.waitForFunction(() => !document.querySelector("#generate").disabled)
    const liveSteps = steps.slice(liveStart)
    assert.ok(liveSteps.some((request) => request.bias.some((bias) => bias.value === 2)))
    assert.ok(liveSteps.some((request) => request.bias.some((bias) => bias.value === -2)))
    assert.equal(new Set(liveSteps.map((request) => request.session)).size, 1)
    assert.deepEqual(errors, [])
    await pause(2200)
    await caption("Real local inference • Key-position attention bias • No cloud API calls")
    await pause(2500)
    writeFileSync(
      resolve(output, "recording-check.json"),
      JSON.stringify(
        {
          real_inference: true,
          playback_speed: 1,
          comparison: await page.locator("#proof").textContent(),
          live_bias_values: [...new Set(liveSteps.flatMap((request) => request.bias.map((bias) => bias.value)))],
          live_session_count: 1,
          browser_errors: errors,
        },
        null,
        2,
      ) + "\n",
    )
  } finally {
    captured = await recording.stop()
  }
  const list = resolve(captured.dir, "mp4-frames.txt")
  writeFileSync(
    list,
    captured.frames.map(({ file, seconds }) => `file '${file}'\nduration ${Math.max(seconds, 0.001).toFixed(4)}`).join("\n") +
      `\nfile '${captured.frames.at(-1).file}'\n`,
  )
  const video = resolve(output, "attention-steering.mp4")
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
      video,
    ],
    { stdio: "inherit" },
  )
  console.log(video)
} finally {
  await browser.close()
}
