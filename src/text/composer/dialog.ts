import { WRITING_EXAMPLES, type WritingSetup } from "./examples.ts"

type Options = {
  dialog: HTMLDialogElement
  current(): WritingSetup
  draft(): string
  start(setup: WritingSetup): void
  continue(instruction: string): void
}

export function createComposerDialog({ dialog, current, draft, start, continue: continueDraft }: Options) {
  const form = dialog.querySelector("form")!
  const template = form.querySelector<HTMLSelectElement>("#composer-template")!
  const prompt = form.querySelector<HTMLTextAreaElement>("#composer-prompt")!
  const opening = form.querySelector<HTMLTextAreaElement>("#composer-opening")!
  const extra = form.querySelector<HTMLTextAreaElement>("#composer-extra")!
  const startFields = form.querySelector<HTMLElement>("#composer-start-fields")!
  const continueFields = form.querySelector<HTMLElement>("#composer-continue-fields")!
  const instruction = form.querySelector<HTMLElement>("#composer-current-prompt")!
  const submit = form.querySelector<HTMLButtonElement>("#composer-apply")!
  const feedback = form.querySelector<HTMLOutputElement>("#composer-feedback")!
  const action = () => form.querySelector<HTMLInputElement>('input[name="compose-action"]:checked')!.value
  form.querySelector("#composer-cancel")!.addEventListener("click", () => dialog.close())
  template.addEventListener("change", fillExample)
  for (const radio of form.querySelectorAll('input[name="compose-action"]')) radio.addEventListener("change", updateAction)
  form.addEventListener("submit", (event) => {
    event.preventDefault()
    try {
      if (action() === "start") start({ kind: template.value === "story" ? "story" : "document", instruction: prompt.value.trim(), opening: opening.value })
      else continueDraft(extra.value)
      dialog.close()
    } catch (error) {
      feedback.value = error instanceof Error ? error.message : String(error)
    }
  })
  return {
    open(newDraft = false) {
      feedback.value = ""
      extra.value = ""
      const setup = current()
      template.value = "custom"
      prompt.value = setup.instruction || WRITING_EXAMPLES.story.instruction
      opening.value = draft() || setup.opening
      instruction.textContent = setup.instruction || WRITING_EXAMPLES.story.instruction
      form.querySelector<HTMLInputElement>(`input[value="${newDraft ? "start" : "continue"}"]`)!.checked = true
      if (newDraft) {
        template.value = "documentation"
        fillExample()
      }
      updateAction()
      dialog.showModal()
    },
  }

  function fillExample() {
    const example = WRITING_EXAMPLES[template.value]
    prompt.value = example.instruction
    opening.value = example.opening
  }

  function updateAction() {
    const creating = action() === "start"
    startFields.hidden = !creating
    continueFields.hidden = creating
    prompt.required = creating
    submit.textContent = creating ? "Start new draft" : "Continue from cursor"
  }
}
