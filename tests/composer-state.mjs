import assert from "node:assert/strict"
import { createWritingSession } from "../src/text/composer/session.ts"
import { WRITING_EXAMPLES } from "../src/text/composer/examples.ts"
import { createLocalSource } from "../src/text/local/source.ts"
import { createTextStream } from "../src/text/text-stream.ts"
const writing = createWritingSession()
writing.start(WRITING_EXAMPLES.email)
const original = writing.current()
writing.continue("")
assert.deepEqual(writing.current(), original, "steering alone preserves the prompt")
writing.continue("Suggest Tuesday at 10am, with flexibility.")
assert.ok(writing.current().instruction.startsWith(original.instruction))
assert.match(writing.current().instruction, /Tuesday/)
assert.equal(writing.current().opening, original.opening)
const before = writing.current()
assert.throws(() => writing.continue("x".repeat(1200)))
assert.deepEqual(writing.current(), before, "invalid follow-up must not mutate the active prompt")
writing.start(WRITING_EXAMPLES.documentation)
assert.doesNotMatch(writing.current().instruction, /Tuesday/)
let init
let step = 0
const local = createLocalSource(
  () => {},
  async (path, body) => {
    if (path.endsWith("init")) {
      init = body
      return { session: "doc", tokens: [] }
    }
    return ++step === 1 ? { token: 1, text: "Purpose\n\nBack up a folder.", done: false } : { done: true }
  },
  true,
  writing.current,
)
let content = ""
for await (const chunk of local.source.complete(WRITING_EXAMPLES.documentation.opening, { leads: [], controls: [] }, new AbortController().signal))
  content += chunk
assert.match(content, /\n\n/)
assert.equal(init.prompt, WRITING_EXAMPLES.documentation.opening)
assert.equal(init.instruction, WRITING_EXAMPLES.documentation.instruction)
assert.equal(init.kind, "document")
assert.equal(local.finished(), true)
local.clearFailure()
assert.equal(local.finished(), false)
const stream = createTextStream({ async *complete() {} }, () => {})
stream.replace("Subject: Review\n\nHi Sam,\n\n")
assert.match(stream.text, /\n\nHi Sam/)
console.log("Composer state passed: preserved prompts, appended directions, validation, raw paragraphs and completion/reset")
