import assert from "node:assert/strict"
import { createLocalSource } from "../src/text/local/source.ts"
import { createTextStream } from "../src/text/text-stream.ts"
const steering = { leads: [], controls: [] }
let inits = 0
let steps = 0
const infer = async (path, body) => {
  if (path.endsWith("init")) {
    inits++
    return { session: String(inits), tokens: [], prompt: body.prompt }
  }
  steps++
  return { text: " word", token: steps, done: false }
}
const { source } = createLocalSource(() => {}, infer, true)
async function read(prefix, input = steering) {
  let text = prefix
  for await (const chunk of source.complete(prefix, input, new AbortController().signal)) text += chunk
  return text
}
let text = await read("A story")
text = await read(text)
assert.equal(inits, 1, "unchanged buffer refill keeps the existing KV cache")
assert.equal(steps, 96)
await read(text, { leads: [{ keyword: "story", keywordSpan: { start: 2, end: 7 } }], controls: [] })
assert.equal(inits, 2, "changed attention rebuilds context")
await read("A story")
assert.equal(inits, 3, "scrubbing back rebuilds context")
let unblock
const delayed = new Promise((resolve) => {
  unblock = resolve
})
let seen
const stream = createTextStream(
  {
    async *complete() {
      await delayed
      yield "hello"
    },
  },
  () => {
    seen = stream.activity()
  },
)
const generation = stream.generate("buffer low", steering)
assert.equal(seen.isGenerating, true, "start is reported before first token")
assert.equal(typeof seen.waitingMs, "number")
unblock()
await generation
assert.equal(stream.activity().isGenerating, false)
console.log("Source lifecycle passed: cache reuse, steering rebuild, rewind, immediate waiting state")
let shiftedStep = 0
const shifted = createLocalSource(
  () => {},
  async (path) => {
    if (path.endsWith("init"))
      return {
        session: "shift",
        tokens: [
          { position: 0, id: 0, start: 0, end: 1, text: "A" },
          { position: 1, id: 1, start: 2, end: 6, text: "rose" },
          { position: 2, id: 2, start: 7, end: 10, text: "old" },
          { position: 3, id: 3, start: 11, end: 17, text: "engine" },
        ],
      }
    return ++shiftedStep === 1
      ? { text: " moved", token: 4, next_position: 4, retained_positions: [0, 3], attention: [0.25, 0.75], attention_layer: 1 }
      : { done: true }
  },
  true,
)
for await (const _ of shifted.source.complete("A rose old engine", steering, new AbortController().signal)) {
}
assert.equal(shifted.relevanceOf("A rose old engine", { start: 11, end: 17 }).relevance, 0.75)
assert.equal(shifted.relevanceOf("A rose old engine", { start: 2, end: 6 }).relevance, 0)
console.log("Shifted attention remains aligned with retained story spans")
let fanInits = 0
let fanSteps = 0
let refillBias
const fanSource = createLocalSource(
  () => {},
  async (path, body) => {
    if (path.endsWith("init")) {
      fanInits++
      return {
        session: "fan",
        tokens: [
          { position: 0, id: 0, start: 0, end: 1, text: "A" },
          { position: 1, id: 1, start: 2, end: 6, text: "rose" },
        ],
      }
    }
    if (fanSteps === 48) refillBias = body.bias
    return { text: "\n\nrose", token: 2, next_position: 2 + fanSteps++, done: false }
  },
  true,
)
const fan = { leads: [], controls: [{ dimension: { kind: "scale", name: "rose", low: "suppress", high: "amplify" }, position: 1, strength: 1 }] }
let fanText = "A rose"
for (let i = 0; i < 2; i++) {
  for await (const chunk of fanSource.source.complete(fanText, fan, new AbortController().signal)) fanText += chunk
}
assert.equal(fanInits, 1, "unchanged fans reuse the existing context")
assert.equal(refillBias.length, 49, "fan bias includes newly generated words using raw whitespace offsets")
assert.ok(refillBias.some(({ position, value }) => position === 49 && value === 4))
let lockText = await read("A story", { leads: [{ keyword: "story", keywordSpan: { start: 2, end: 7 }, after: "" }], controls: [] })
const lockInits = inits
await read(lockText, { leads: [{ keyword: "story", keywordSpan: { start: 2, end: 7 }, after: "word word" }], controls: [] })
assert.equal(inits, lockInits, "new neighboring display words do not restart unchanged attention")
console.log("Fan refills and growing lock surroundings keep streaming without reinitializing")
