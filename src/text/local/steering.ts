import type { Bias, PromptToken } from "../../local/generation.ts"
import type { Lead } from "../attention.ts"
import type { Control, Dimension } from "../dimension.ts"
import { wordSpans, type Span } from "../segments.ts"

const encoder = new TextEncoder()

export function attentionBias(prefix: string, tokens: PromptToken[], leads: Lead[], controls: Control[]): Bias[] {
  const values = new Map<number, number>()
  const add = (span: Span, value: number) => {
    const start = encoder.encode(prefix.slice(0, span.start)).length
    const end = encoder.encode(prefix.slice(0, span.end)).length
    for (const token of tokens) {
      if (token.start < end && token.end > start) values.set(token.position, (values.get(token.position) ?? 0) + value)
    }
  }
  for (const lead of leads) {
    if (lead.keywordSpan && prefix.slice(lead.keywordSpan.start, lead.keywordSpan.end) === lead.keyword) add(lead.keywordSpan, 2)
  }
  for (const { dimension, position, strength } of controls) {
    if (dimension.kind !== "scale" || dimension.low !== "suppress" || dimension.high !== "amplify") continue
    for (const span of wordSpans(prefix)) {
      if (prefix.slice(span.start, span.end) === dimension.name) add(span, (position * 2 - 1) * strength * 4)
    }
  }
  return [...values].map(([position, value]) => ({ position, value: Math.max(-8, Math.min(8, value)) }))
}

export function wordDimensions(text: string, leads: Lead[], taken: Dimension[]): Dimension[] {
  const excluded = new Set(taken.map(({ name }) => name))
  const words = [
    ...leads.map(({ keyword }) => keyword),
    ...wordSpans(text)
      .map(({ start, end }) => text.slice(start, end))
      .filter((word) => word.length > 4),
  ]
  return [...new Set(words)]
    .filter((name) => !excluded.has(name))
    .slice(0, 5)
    .map((name) => ({ name, kind: "scale", low: "suppress", high: "amplify" }))
}

/** Maps collapsed canvas whitespace back to the model's raw UTF-8 token offsets. */
export function byteSpan(raw: string, span: Span): Span {
  const offset = (target: number) => {
    let source = 0,
      shown = 0
    while (source < raw.length && shown < target) {
      if (/\s/.test(raw[source])) while (source < raw.length && /\s/.test(raw[source])) source++
      else source++
      shown++
    }
    return encoder.encode(raw.slice(0, source)).length
  }
  return { start: offset(span.start), end: offset(span.end) }
}
