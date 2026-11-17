import { chromium, webkit } from "playwright-core"
import assert from "node:assert/strict"
import { mkdir, writeFile, readdir } from "node:fs/promises"
const base = process.env.BROWSER_URL ?? "http://127.0.0.1:8090"
await mkdir(".capture-local/browser", { recursive: true })
const engine = process.env.ENGINE ?? "chromium"
const browser = await (engine === "webkit"
  ? webkit.launch({ headless: true })
  : chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true }))
try {
  const context = await browser.newContext({ viewport: { width: 852, height: 393 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 })
  if (process.env.MODEL_URL)
    await context.route("**/runtime/manifest.json", async (route) => {
      const response = await route.fetch()
      const manifest = await response.json()
      manifest.models.find((model) => model.id === (process.env.MODEL_ID ?? "qwen2.5-0.5b")).url = process.env.MODEL_URL
      await route.fulfill({ json: manifest })
    })
  const page = await context.newPage()
  const errors = [],
    api = [],
    failed = []
  page.on("pageerror", (e) => {
    errors.push(e.message)
    console.log("page error", e.message)
  })
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/")) api.push(r.url())
  })
  page.on("requestfailed", (r) => failed.push({ url: r.url(), reason: r.failure()?.errorText }))
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") console.log("console", m.text().slice(0, 300))
  })
  await page.goto(base)
  if (process.env.MODEL_ID) await page.locator("#browser-model").selectOption(process.env.MODEL_ID)
  await page.locator("#browser-load").click()
  let latest = ""
  const timer = setInterval(async () => {
    try {
      const t = await page.locator("#browser-progress").textContent()
      if (t !== latest) {
        latest = t
        console.log(t)
      }
    } catch {}
  }, 10000)
  try {
    await page.waitForFunction(() => !document.querySelector("#browser-start").open, null, { timeout: 240000 })
  } finally {
    clearInterval(timer)
  }
  await page.waitForFunction(() => document.querySelector("#status [data-field=rate] b").textContent !== "—", null, { timeout: 120000 })
  console.log("browser generation started", await page.locator("#status").textContent())
  const metrics = await page.locator("#text").evaluate((e) => {
    const r = e.getBoundingClientRect(),
      s = getComputedStyle(e)
    return { x: r.x, y: r.y + parseFloat(s.paddingTop), width: r.width, line: parseFloat(s.lineHeight) }
  })
  const point = await page.locator("#pointer").evaluate((e) => {
    const r = e.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  if (engine === "chromium") {
    const cdp = await context.newCDPSession(page)
    const target = { x: metrics.x + metrics.width * 0.95, y: metrics.y + metrics.line * 7.5 }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...point, id: 0 }] })
    for (let i = 1; i <= 20; i++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: point.x + ((target.x - point.x) * i) / 20, y: point.y + ((target.y - point.y) * i) / 20, id: 0 }],
      })
      await page.waitForTimeout(20)
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  } else {
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    await page.mouse.move(metrics.x + metrics.width * 0.95, metrics.y + metrics.line * 7.5, { steps: 25 })
    await page.mouse.up()
  }
  await page.waitForTimeout(1000)
  assert.match(await page.locator("#text").textContent(), /spaceship/)
  const rose = await page.locator("#text").evaluate((e) => {
    const n = e.firstChild,
      s = n.textContent.indexOf("roses"),
      r = document.createRange()
    r.setStart(n, s)
    r.setEnd(n, s + 5)
    return r.getBoundingClientRect().toJSON()
  })
  await page.touchscreen.tap(rose.x + rose.width / 2, rose.y + rose.height / 2)
  await page.waitForFunction(() => (CSS.highlights.get("attention-word")?.size ?? 0) > 0)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: ".capture-local/browser/landscape.png", fullPage: true })
  await page.setViewportSize({ width: 393, height: 852 })
  await page.screenshot({ path: ".capture-local/browser/portrait.png", fullPage: true })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  assert.deepEqual(errors, [])
  assert.deepEqual(api, [])
  const text = await page.locator("#text").textContent()
  const workerFile = (await readdir("dist/assets")).find((n) => n.startsWith("worker-") && n.endsWith(".js"))
  await page.close()
  const diagnostic = await context.newPage()
  await diagnostic.goto(base + "/?sim=true")
  const mechanism = await diagnostic.evaluate(
    async ({ url, modelId }) => {
      const worker = new Worker(url, { type: "module" }),
        pending = new Map()
      let id = 0
      worker.onmessage = ({ data }) => {
        if (data.id) {
          const p = pending.get(data.id)
          if (data.error) p.reject(new Error(data.error))
          else p.resolve(data.result)
          pending.delete(data.id)
        }
      }
      const call = (op, body) =>
        new Promise((resolve, reject) => {
          const key = ++id
          pending.set(key, { resolve, reject })
          worker.postMessage({ id: key, op, body })
        })
      const loaded = await call("load", { model: modelId })
      const prompt =
        "The spaceship carried two things: a greenhouse full of roses and a damaged engine. Mira loved the garden, but the mechanic worried about the reactor. When she opened the hatch, she found"
      let session = await call("init", { prompt })
      const position = session.tokens.find((t) => t.start < prompt.indexOf("roses") + 5 && t.end > prompt.indexOf("roses")).position
      const neutral = await call("step", { session: session.session, bias: [] })
      session = await call("init", { prompt })
      const zero = await call("step", { session: session.session, bias: [{ position, value: 0 }] })
      session = await call("init", { prompt })
      const steered = await call("step", { session: session.session, bias: [{ position, value: 2 }] })
      const generated = await call("step", { session: session.session, bias: [{ position: steered.next_position, value: 2 }] })
      worker.terminate()
      return { loaded, position, neutral, zero, steered, generated }
    },
    { url: base + "/assets/" + workerFile, modelId: process.env.MODEL_ID ?? "qwen2.5-0.5b" },
  )
  assert.equal(mechanism.loaded.cached, true)
  assert.equal(mechanism.generated.bias[0].position, mechanism.steered.next_position)
  assert.ok(Math.abs(mechanism.generated.attention.reduce((a, b) => a + b, 0) - 1) < 0.0001)
  assert.deepEqual(mechanism.neutral.top, mechanism.zero.top)
  assert.notDeepEqual(mechanism.neutral.top, mechanism.steered.top)
  assert.ok(Math.abs(mechanism.neutral.attention.reduce((a, b) => a + b, 0) - 1) < 0.0001)
  assert.ok(mechanism.steered.attention[mechanism.position] > mechanism.neutral.attention[mechanism.position])
  await writeFile(
    `evidence/browser-story-${engine}-${process.env.MODEL_ID ?? "qwen2.5-0.5b"}-check.json`,
    JSON.stringify(
      {
        host: base,
        model_id: process.env.MODEL_ID ?? "qwen2.5-0.5b",
        model_url_override: process.env.MODEL_URL ?? null,
        backend: "real WASM SIMD in worker",
        inference_api_requests: api,
        browser_errors: errors,
        failed_requests: failed,
        touch_lock: true,
        touch_scrub: engine === "chromium",
        portrait_overflow: false,
        visible_text: text,
        mechanism,
      },
      null,
      2,
    ) + "\n",
  )
  console.log(
    "Browser-only story checks passed: real generation, touch lock, mobile layout, cached model reopen, neutral equivalence, changed distribution and measured attention.",
  )
  await context.close()
} finally {
  await browser.close()
}
