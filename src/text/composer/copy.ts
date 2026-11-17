export function bindDraftCopy(button: HTMLButtonElement, draft: () => string) {
  let timer: number | undefined
  button.addEventListener("click", async () => {
    const text = draft().trimEnd()
    if (!text) return show("no visible draft")
    try {
      await navigator.clipboard.writeText(text)
      show("copied")
    } catch {
      const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }))
      const link = Object.assign(document.createElement("a"), { href: url, download: "spaceship-draft.txt" })
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      show("saved .txt")
    }
  })

  function show(label: string) {
    clearTimeout(timer)
    button.textContent = label
    timer = setTimeout(() => {
      button.textContent = "copy draft"
    }, 2500)
  }
}
