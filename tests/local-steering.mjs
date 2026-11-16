import { collapsedSpan } from "../src/text/segments.ts"
import { test } from "node:test"
import assert from "node:assert/strict"
import { attentionBias, byteSpan, wordDimensions } from "../src/text/local/steering.ts"

test("exact positions distinguish duplicate Unicode keywords", () => {
  const prefix = "café and café"
  const tokens = [
    { position: 0, start: 0, end: 5 },
    { position: 1, start: 5, end: 9 },
    { position: 2, start: 9, end: 14 },
  ]
  const lead = { before: "", keyword: "café", after: "", keywordSpan: { start: 9, end: 13 } }
  assert.deepEqual(attentionBias(prefix, tokens, [lead], []), [{ position: 2, value: 2 }])
  assert.deepEqual(attentionBias(prefix, tokens, [{ ...lead, keywordSpan: { start: 3, end: 7 } }], []), [])
})
test("fan angle and distance set signed attention bias without prompt text", () => {
  const dimension = { name: "roses", kind: "scale", low: "suppress", high: "amplify" }
  const tokens = [{ position: 0, start: 0, end: 5 }]
  assert.deepEqual(attentionBias("roses", tokens, [], [{ dimension, position: 0, strength: 0.5 }]), [{ position: 0, value: -2 }])
  assert.deepEqual(attentionBias("roses", tokens, [], [{ dimension, position: 1, strength: 0.5 }]), [{ position: 0, value: 2 }])
})
test("offered fan dimensions refer only to story words and respect taken words", () => {
  const choices = wordDimensions("The garden contained roses", [], [{ name: "garden" }])
  assert.ok(choices.every((dimension) => dimension.low === "suppress" && dimension.high === "amplify"))
  assert.ok(choices.some((dimension) => dimension.name === "roses"))
  assert.ok(!choices.some((dimension) => dimension.name === "garden"))
})
test("rail spans map collapsed whitespace back to raw UTF-8 positions", () => {
  assert.deepEqual(byteSpan("café\n\n  roses", { start: 5, end: 10 }), { start: 9, end: 14 })
})

test("original layout spacing preserves a lock's exact model position", () => {
  const canvas = "roses  and a damaged engine"
  const span = collapsedSpan(canvas, { start: canvas.indexOf("engine"), end: canvas.length })
  const prefix = "roses and a damaged engine"
  assert.equal(prefix.slice(span.start, span.end), "engine")
})
