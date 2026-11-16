import { KEY_STORAGE as CEREBRAS_KEY_STORAGE } from "../llm/cerebras.ts"
import { KEY_STORAGE as GEMINI_KEY_STORAGE } from "../llm/decisions.ts"

/** Each key's field in the dialog's form, by name, and where it is kept for reuse. */
const KEY_FIELDS = { cerebras: CEREBRAS_KEY_STORAGE, gemini: GEMINI_KEY_STORAGE }

/**
 * Sim plays simulated sources; flight calls the models. The sources are chosen when the page loads, so switching reloads it in the other mode.
 * The existing launch dialog offers local inference without keys, or cloud inference with saved API keys.
 */
export function bindModeToggle(toggle: HTMLButtonElement, dialog: HTMLDialogElement, isLive: boolean, isLocal = false) {
  const form = dialog.querySelector("form")!
  const inputOf = (name: string) => form.elements.namedItem(name) as HTMLInputElement
  toggle.setAttribute("aria-pressed", `${isLive || isLocal}`)
  toggle.querySelector("b")!.textContent = isLocal ? "local" : isLive ? "flight" : "sim"

  toggle.addEventListener("click", () => {
    if (isLocal || isLive) return reloadAs(false)
    for (const [name, storageKey] of Object.entries(KEY_FIELDS)) inputOf(name).value = localStorage.getItem(storageKey) ?? ""
    dialog.showModal()
  })
  dialog.addEventListener("close", () => {
    const choice = dialog.returnValue
    dialog.returnValue = ""
    if (choice === "local") {
      const url = new URL(location.href)
      url.searchParams.delete("live")
      url.searchParams.set("local", "true")
      return location.assign(url)
    }
    if (choice !== "live") return
    for (const [name, storageKey] of Object.entries(KEY_FIELDS)) localStorage.setItem(storageKey, inputOf(name).value.trim())
    reloadAs(true)
  })
}

function reloadAs(isLive: boolean) {
  const url = new URL(location.href)
  url.searchParams.delete("local")
  if (isLive) url.searchParams.set("live", "true")
  else url.searchParams.delete("live")
  location.assign(url)
}
