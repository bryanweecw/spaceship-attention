import "@fontsource-variable/jetbrains-mono/wght.css"
import "./style.css"
import { $, downloadJson } from "../dom.ts"
import { generate, request, type Bias, type Decode, type PromptSession } from "./generation.ts"

const prompt = $<HTMLTextAreaElement>("#prompt")
const form = $<HTMLFormElement>("#prompt-form")
const loadButton = $<HTMLButtonElement>("#load")
const tokensElement = $("#tokens")
const weight = $<HTMLInputElement>("#weight")
const weightValue = $<HTMLOutputElement>("#weight-value")
const clearButton = $<HTMLButtonElement>("#clear")
const generateButton = $<HTMLButtonElement>("#generate")
const compareButton = $<HTMLButtonElement>("#compare")
const stopButton = $<HTMLButtonElement>("#stop")
const downloadButton = $<HTMLButtonElement>("#download")
const limit = $<HTMLInputElement>("#limit")
const status = $("#status")
const selected = new Set<number>()
let anchor = 0
let session: PromptSession | undefined
let controller: AbortController | undefined
let busy = false
let run: { prompt: string; mode: string; baseline: Decode[]; steered: Decode[]; completed: boolean } | undefined

form.addEventListener("submit", (event) => {
  event.preventDefault()
  void perform(async () => {
    session = await request<PromptSession>("/api/init", { prompt: prompt.value })
    selected.clear()
    renderTokens()
    $("#baseline").textContent = "Run a comparison to see the unmodified continuation."
    $("#steered").textContent = "Your continuation will appear here."
    run = undefined
    downloadButton.disabled = true
    status.textContent = "Prompt loaded. Select tokens, then generate or compare."
  })
})

prompt.addEventListener("input", () => {
  session = undefined
  selected.clear()
  tokensElement.replaceChildren()
  $("#token-count").textContent = "Prompt changed. Load it again to select tokens."
  updateControls()
})

weight.addEventListener("input", showWeight)
clearButton.addEventListener("click", () => {
  selected.clear()
  renderSelection()
})
stopButton.addEventListener("click", () => {
  controller?.abort()
  stopButton.disabled = true
  status.textContent = "Stopping after the current token..."
})

generateButton.addEventListener("click", () => {
  void perform(async () => {
    const current = session!
    controller = new AbortController()
    run = { prompt: current.prompt, mode: "live", baseline: [], steered: [], completed: false }
    $("#steered").textContent = ""
    $("#baseline").textContent = "Run a comparison to see the unmodified continuation."
    $("#proof").textContent = "Live run. Each decode records the key-position biases active at that step; download JSON to inspect them."
    status.textContent = "Generating. Change the selection or weight to steer the next token."
    // A fresh neutral prefill gives every run the same starting cache.
    session = await request<PromptSession>("/api/init", { prompt: current.prompt })
    await consume("steered", currentBias)
    run.completed = !controller.signal.aborted
    status.textContent = run.completed
      ? "Generation complete. Generate again to restart, or compare both paths."
      : "Stopped. Generate again to restart from the prompt."
  })
})

compareButton.addEventListener("click", () => {
  void perform(async () => {
    const current = session!
    const bias = currentBias()
    controller = new AbortController()
    run = { prompt: current.prompt, mode: "comparison", baseline: [], steered: [], completed: false }
    $("#baseline").textContent = ""
    $("#steered").textContent = ""
    setSelectionDisabled(true)
    status.textContent = "Generating baseline with zero bias..."
    session = await request<PromptSession>("/api/init", { prompt: current.prompt })
    await consume("baseline", () => [])
    if (controller.signal.aborted) {
      status.textContent = "Comparison stopped. Run it again for a complete pair."
      return
    }
    status.textContent = "Generating steered continuation from the identical prompt..."
    session = await request<PromptSession>("/api/init", { prompt: current.prompt })
    await consume("steered", () => bias)
    run.completed = !controller.signal.aborted
    const before = run.baseline[0]?.top[0]
    const after = run.steered[0]?.top[0]
    $("#proof").textContent =
      `Identical prompt (${current.prompt_tokens} tokens), identical neutral prefill, greedy decoding. First choice: ${JSON.stringify(before?.text)} (${((before?.probability ?? 0) * 100).toFixed(2)}%) baseline; ${JSON.stringify(after?.text)} (${((after?.probability ?? 0) * 100).toFixed(2)}%) steered. Download JSON for both distributions and per-step biases.`
    status.textContent = run.completed
      ? "Comparison complete. Only selected key-position attention biases differ."
      : "Comparison stopped; the downloaded run is marked incomplete."
  })
})

downloadButton.addEventListener("click", () => {
  downloadJson("attention-run.json", {
    mechanism: "softmax(QK^T / sqrt(d) + causal_mask + key_position_bias)",
    decoding: "greedy",
    prompt_prefill: "neutral; bias begins at final prompt query",
    ...run,
  })
})

showWeight()
void request<{ ready: boolean; model: string }>("/api/health")
  .then((health) => {
    if (!health.ready) throw new Error("runner stopped")
    $("#connection").textContent = `llama.cpp / ${health.model}`
  })
  .catch(() => {
    $("#connection").textContent = "Model unavailable. Start native/server.py, then reload."
    loadButton.disabled = true
  })

async function perform(task: () => Promise<void>) {
  if (busy) return
  busy = true
  updateControls()
  try {
    await task()
  } catch (error) {
    session = undefined
    status.textContent = `${error instanceof Error ? error.message : error}. Load the prompt again to retry.`
  } finally {
    busy = false
    controller = undefined
    setSelectionDisabled(false)
    updateControls()
    downloadButton.disabled = !run
  }
}

async function consume(target: "baseline" | "steered", bias: () => Bias[]) {
  const count = Math.max(1, Math.min(256, Number(limit.value) || 64))
  for await (const result of generate(session!.session, bias, count, controller!.signal)) {
    run![target].push(result)
    if (!result.done) $("#" + target).append(document.createTextNode(result.text))
    const rows = result.top.map((token) => {
      const row = document.createElement("tr")
      for (const text of [JSON.stringify(token.text), `${(token.probability * 100).toFixed(3)}%`]) {
        const cell = document.createElement("td")
        cell.textContent = text
        row.append(cell)
      }
      return row
    })
    $("#probabilities").replaceChildren(...rows)
    $("#probability-caption").textContent = `${target} / query position ${result.position} / ${result.bias.length} weighted keys`
  }
}

function renderTokens() {
  tokensElement.replaceChildren(
    ...session!.tokens.map((token) => {
      const button = document.createElement("button")
      button.type = "button"
      button.textContent = token.text || "[special]"
      button.dataset.position = String(token.position)
      button.title = `Token ${token.position}, ID ${token.id}`
      button.setAttribute("aria-label", `Token ${token.position}: ${JSON.stringify(token.text)}`)
      button.addEventListener("click", (event) => {
        if (event.shiftKey) {
          for (let i = Math.min(anchor, token.position); i <= Math.max(anchor, token.position); i++) selected.add(i)
        } else {
          if (selected.has(token.position)) selected.delete(token.position)
          else selected.add(token.position)
          anchor = token.position
        }
        renderSelection()
      })
      return button
    }),
  )
  renderSelection()
}

function renderSelection() {
  for (const button of tokensElement.querySelectorAll("button")) button.setAttribute("aria-pressed", String(selected.has(Number(button.dataset.position))))
  $("#token-count").textContent = `${selected.size} selected / ${session?.prompt_tokens ?? 0} prompt tokens`
  clearButton.disabled = selected.size === 0
  showWeight()
}

function currentBias(): Bias[] {
  return [...selected].map((position) => ({ position, value: Number(weight.value) }))
}

function showWeight() {
  const value = Number(weight.value)
  weightValue.value = `${value >= 0 ? "+" : ""}${value.toFixed(2)}`
  $("#weight-description").textContent =
    `${weightValue.value} multiplies the selected keys’ attention odds by ${Math.exp(value).toFixed(2)} before normalization. ${selected.size} keys selected.`
}

function setSelectionDisabled(disabled: boolean) {
  weight.disabled = disabled
  clearButton.disabled = disabled || selected.size === 0
  for (const button of tokensElement.querySelectorAll("button")) button.disabled = disabled
}

function updateControls() {
  loadButton.disabled = busy
  prompt.disabled = busy
  limit.disabled = busy
  generateButton.disabled = busy || !session
  compareButton.disabled = busy || !session
  stopButton.disabled = !busy
}
