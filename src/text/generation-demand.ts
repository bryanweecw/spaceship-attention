import { layoutNextLine, type PreparedTextWithSegments } from "@chenglou/pretext"
import { isAhead, type Caret } from "./caret.ts"
import { countWords } from "./words.ts"

export function generationDemand(layout: PreparedTextWithSegments, caret: Caret, width: number, text: string, shownWords: number, reserve: number) {
  let cursor
  let end: Caret = { line: 0, x: 0 }
  for (let line = 0; ; line++) {
    const next = layoutNextLine(layout, width, cursor)
    if (!next) break
    end = { line, x: next.width }
    cursor = next.end
  }
  const buffer = Math.max(0, countWords(text) - shownWords)
  const cursorLines = isAhead(caret, end) ? Math.max(0, caret.line - end.line) : undefined
  return { buffer, cursorLines, needsGeneration: cursorLines !== undefined || buffer < reserve }
}
