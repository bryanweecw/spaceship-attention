export function createBrowserEngine(dialog: HTMLDialogElement, loadButton: HTMLButtonElement, progress: HTMLOutputElement) {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
  let id = 0
  let failed = false
  let runtimeFailure: Error | undefined
  let release!: () => void
  const started = new Promise<void>((resolve) => {
    release = resolve
  })
  let loading: Promise<unknown>
  const pending = new Map<number, { resolve(value: unknown): void; reject(reason: Error): void }>()
  worker.onmessage = ({ data }) => {
    if (data.progress) {
      const { phase, received, total } = data.progress
      progress.value = `${phase}: ${Math.min(100, Math.round((received / total) * 100))}% (${Math.round(received / 1048576)} / ${Math.round(total / 1048576)} MB)`
      return
    }
    const request = pending.get(data.id)
    if (!request) return
    pending.delete(data.id)
    if (data.error) request.reject(new Error(data.error))
    else request.resolve(data.result)
  }
  worker.onerror = (event) => {
    const error = new Error(event.message || "The browser runtime stopped. Reload to try again.")
    runtimeFailure = error
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  }
  loadButton.addEventListener("click", () => {
    if (failed) return location.reload()
    loadButton.disabled = true
    progress.value = "Starting WebAssembly runtime..."
    loading = send("load")
    release()
    loading.then(
      () => dialog.close(),
      (error) => {
        failed = true
        progress.value = `${error.message} No story text was sent to a server.`
        loadButton.textContent = "Reload to retry"
        loadButton.disabled = false
      },
    )
  })
  dialog.addEventListener("cancel", (event) => event.preventDefault())
  dialog.showModal()
  return {
    async request<T>(path: string, body?: unknown): Promise<T> {
      await started
      await loading
      return send(path.endsWith("init") ? "init" : "step", body) as Promise<T>
    },
  }

  function send(op: string, body?: unknown): Promise<unknown> {
    if (runtimeFailure) return Promise.reject(runtimeFailure)
    return new Promise((resolve, reject) => {
      const key = ++id
      const timeout =
        op === "load"
          ? undefined
          : setTimeout(
              () => {
                runtimeFailure = new Error("Browser inference stopped responding. Reload to restart the model.")
                worker.terminate()
                for (const request of pending.values()) request.reject(runtimeFailure)
                pending.clear()
              },
              op === "init" ? 120000 : 30000,
            )
      pending.set(key, {
        resolve(value) {
          clearTimeout(timeout)
          resolve(value)
        },
        reject(error) {
          clearTimeout(timeout)
          reject(error)
        },
      })
      worker.postMessage({ id: key, op, body })
    })
  }
}
