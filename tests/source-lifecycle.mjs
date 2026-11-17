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
