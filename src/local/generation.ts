export type Bias = { position: number; value: number }
export type PromptToken = { position: number; id: number; text: string; start: number; end: number }
export type PromptSession = { session: string; prompt: string; prompt_tokens: number; tokens: PromptToken[] }
export type Decode = { token: number; text: string; done: boolean; position: number; bias: Bias[]; top: { id: number; text: string; probability: number }[] }

export async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    path,
    body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  )
  const data = await response.json()
  if (!response.ok || data.error) throw new Error(data.error ?? `Request failed (${response.status})`)
  return data as T
}

export async function* generate(session: string, bias: () => Bias[], limit: number, signal: AbortSignal): AsyncIterable<Decode> {
  for (let i = 0; i < limit && !signal.aborted; i++) {
    // Finish the in-flight decode when stopped, keeping the server's KV state consistent.
    const result = await request<Decode>("/api/step", { session, bias: bias() })
    yield result
    if (result.done) return
  }
}
