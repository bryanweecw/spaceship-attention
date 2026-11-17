import { WRITING_EXAMPLES, type WritingSetup } from "./examples.ts"

export function createWritingSession() {
  let setup: WritingSetup = { ...WRITING_EXAMPLES.story, instruction: "" }
  return {
    current: () => ({ ...setup }),
    start(next: WritingSetup) {
      if (next.kind === "document" && !next.instruction.trim()) throw new Error("Enter a writing prompt for the new draft.")
      validate(next.instruction)
      setup = { ...next }
    },
    continue(instruction: string) {
      const extra = instruction.trim()
      if (!extra) return
      const combined = `${setup.instruction || WRITING_EXAMPLES.story.instruction}\n\nDirection for the next text only:\n${extra}`
      validate(combined)
      setup = { ...setup, instruction: combined }
    },
  }
}

function validate(instruction: string) {
  if (instruction.length > 1200) throw new Error("Keep the combined writing instructions under 1,200 characters. Start a new draft to use a shorter prompt.")
}
