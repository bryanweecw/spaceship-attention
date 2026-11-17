import { request, type Decode, type PromptSession, type PromptToken } from "../../local/generation.ts"
import type { AttentionSource } from "../attention.ts"
import type { DimensionSource } from "../dimension.ts"
import type { RailState } from "../left-rail.ts"
import type { LeadRelevance } from "../keyword-relevance.ts"
import { wordSpans, collapsedSpan, type Span } from "../segments.ts"
import type { TextSource } from "../text-stream.ts"
import { attentionBias, wordDimensions, byteSpan } from "./steering.ts"

const OPENING =
  "The spaceship carried two things: a greenhouse full of roses and a damaged engine. Mira loved the garden, but the mechanic worried about the reactor. When she opened the hatch, she found"

type Snapshot = { context: string; tokens: PromptToken[]; attention: number[]; layer: number }

/** Owns inference ordering and measured attention for the original canvas, including its buffered future. */
export function createLocalSource(onMeasurement: () => void, infer: typeof request = request, mobile = false) {
  let pending = Promise.resolve()
  let snapshots: Snapshot[] = []
  let failure: string | undefined
  let continuation:
    { prompt: string; context: string; steering: string; session: PromptSession; tokens: PromptToken[]; bias: ReturnType<typeof attentionBias> } | undefined
  const source: TextSource = {
    expand: (text) => text || OPENING,
    async *complete(prefix, steering, signal) {
      const previous = pending
      let release!: () => void
      pending = new Promise<void>((resolve) => {
        release = resolve
      })
      await previous
      try {
        signal.throwIfAborted()
        const prompt = normalize(prefix)
        const signature = JSON.stringify(steering)
        const cached = steering.controls.length === 0 && continuation?.prompt === prompt && continuation.steering === signature ? continuation : undefined
        continuation = undefined
        failure = undefined
        const session = cached?.session ?? (await infer<PromptSession>("/api/init", { prompt }))
        signal.throwIfAborted()
        snapshots = snapshots.filter(({ context }) => prompt.startsWith(normalize(context)) && normalize(context).length < prompt.length)
        const bias = cached?.bias ?? attentionBias(prompt, session.tokens, steering.leads, steering.controls)
        const tokens = [...(cached?.tokens ?? session.tokens)]
        let context = cached?.context ?? prompt
        let emitted = prompt
        failure = undefined
        for (let i = 0; i < (mobile ? 48 : 256) && !signal.aborted; i++) {
          const result = await infer<Decode>("/api/step", { session: session.session, bias })
          if (signal.aborted) return
          if (result.attention?.length) {
            snapshots.push({ context, tokens: [...tokens], attention: result.attention, layer: result.attention_layer! })
            if (snapshots.length > (mobile ? 256 : 2048)) snapshots.shift()
            onMeasurement()
          }
          if (result.done) return
          const start = new TextEncoder().encode(context).length
          tokens.push({ position: tokens.length, id: result.token, text: result.text, start, end: start + new TextEncoder().encode(result.text).length })
          context += result.text
          const next = normalize(context)
          if (next.length > emitted.length) yield next.slice(emitted.length)
          emitted = next
        }
        if (!signal.aborted) continuation = { prompt: emitted, context, steering: signature, session, tokens, bias }
      } catch (error) {
        if (!signal.aborted) {
          failure = error instanceof Error ? error.message : String(error)
          onMeasurement()
          throw error
        }
      } finally {
        release()
      }
    },
  }

  const attention: AttentionSource = async function* (text, signal) {
    const words = wordSpans(text)
    const snapshot = at(text)
    const ranked = words
      .map((span, keyword) => ({ keyword, mass: snapshot ? massOf(snapshot, text, span) : 0 }))
      .filter(({ keyword }) => text.slice(words[keyword].start, words[keyword].end).length > 3)
      .sort((a, b) => b.mass - a.mass)
    for (const { keyword } of ranked.slice(0, 3)) {
      signal.throwIfAborted()
      yield { keyword, before: 2, after: 2 }
    }
  }

  const dimensions: DimensionSource = async function* ({ text, leads, taken }, signal) {
    for (const dimension of wordDimensions(text, leads, taken)) {
      signal.throwIfAborted()
      yield dimension
    }
  }

  return {
    source,
    attention,
    dimensions,
    railState,
    relevanceOf,
    failure: () => failure,
    clearFailure: () => {
      failure = undefined
    },
  }

  function at(text: string) {
    const shown = normalize(text).trimEnd()
    const matching = snapshots.filter(({ context }) => normalize(context).startsWith(shown) || shown.startsWith(normalize(context)))
    return matching.find(({ context }) => normalize(context).length >= shown.length) ?? matching.at(-1)
  }

  function relevanceOf(text: string, span: Span): LeadRelevance {
    const snapshot = at(text)
    return { relevance: snapshot ? massOf(snapshot, text, span) : undefined, isMeasuring: false }
  }

  function railState(text: string, lines: Span[], boxes: RailState["boxes"]): RailState {
    const snapshot = at(text)
    if (!snapshot) return { lines, boxes }
    const strengths = lines.map((span) => ({ span, strength: massOf(snapshot, text, span) }))
    return {
      lines,
      boxes: boxes.map((box) => ({ ...box, ...relevanceOf(text, box.keyword) })),
      connection: { kind: "tip", focus: { start: text.length, end: text.length }, strengths },
    }
  }
}

function massOf(snapshot: Snapshot, shown: string, span: Span) {
  const { start, end } = byteSpan(snapshot.context, collapsedSpan(shown, span))
  return snapshot.tokens.reduce((sum, token, index) => sum + (token.start < end && token.end > start ? (snapshot.attention[index] ?? 0) : 0), 0)
}

function normalize(text: string) {
  return text.replace(/\s+/g, " ")
}
