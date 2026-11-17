export type WritingSetup = { kind: "story" | "document"; instruction: string; opening: string }

export const WRITING_EXAMPLES: Record<string, WritingSetup> = {
  story: {
    kind: "story",
    instruction:
      "Continue an ongoing science-fiction story about Mira, a spaceship, a rose garden and a damaged engine. Develop new events without summaries or repeated passages.",
    opening:
      "The spaceship carried two things: a greenhouse full of roses and a damaged engine. Mira loved the garden, but the mechanic worried about the reactor. When she opened the hatch, she found",
  },
  documentation: {
    kind: "document",
    instruction:
      "Write a concise quick-start guide for sprout, a toy folder-backup CLI. Its only supported command is: sprout backup ./notes --output notes.zip. Explain purpose, usage and limitations. It makes local zip archives; it has no cloud sync or encryption. Do not invent other features or commands. Use Markdown.",
    opening: "# sprout quick start\n\n",
  },
  proposal: {
    kind: "document",
    instruction:
      "Write a short proposal for a two-week pilot of a searchable team knowledge base. Audience: operations lead. Current problem: repeated questions and scattered notes. Budget cap: $500. Success: five teammates can find a useful answer within two minutes. Include approach, success measures, risks and next steps. Do not invent results or commitments.",
    opening: "# Proposal: searchable team notes\n\n",
  },
  email: {
    kind: "document",
    instruction:
      "Draft a short email to Sam asking for a 20-minute meeting next week to review an accessibility audit. Use a warm, direct tone. Ask which time works for Sam. Do not invent audit findings or promise fixes. Write only the email.",
    opening: "Subject: Accessibility audit review\n\nHi Sam,\n\n",
  },
  custom: { kind: "document", instruction: "", opening: "" },
}
