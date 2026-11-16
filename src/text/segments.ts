export type Span = { start: number; end: number }

const wordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" })

export function wordSpans(text: string): Span[] {
  return [...wordSegmenter.segment(text)].filter(({ isWordLike }) => isWordLike).map(({ index, segment }) => ({ start: index, end: index + segment.length }))
}

const sentenceSegmenter = new Intl.Segmenter(undefined, { granularity: "sentence" })

/** Every sentence of `text`, trailing whitespace included, so the spans tile the whole text. */
export function sentenceSpans(text: string): Span[] {
  return [...sentenceSegmenter.segment(text)].map(({ index, segment }) => ({ start: index, end: index + segment.length }))
}

/** Offsets in the single-space text sent to the model, preserving occurrence identity. */
export function collapsedSpan(text: string, span: Span): Span {
  return { start: text.slice(0, span.start).replace(/\s+/g, " ").length, end: text.slice(0, span.end).replace(/\s+/g, " ").length }
}
