import { describe, expect, it } from "vitest"
import { ADVISOR_TOOL_DESCRIPTION, advisorSystemPrompt } from "../src/host/prompts"

describe("advisor prompts", () => {
  it("tells the executor when to call the advisor, as Claude Code does", () => {
    expect(ADVISOR_TOOL_DESCRIPTION).toContain("It takes NO parameters")
    expect(ADVISOR_TOOL_DESCRIPTION).toContain("Call advisor BEFORE substantive work")
    expect(ADVISOR_TOOL_DESCRIPTION).toContain("When you believe the task is complete.")
    expect(ADVISOR_TOOL_DESCRIPTION).toContain("When stuck")
    expect(ADVISOR_TOOL_DESCRIPTION).toContain("When considering a change of approach.")
    expect(ADVISOR_TOOL_DESCRIPTION).toContain("Give the advice serious weight.")
    expect(ADVISOR_TOOL_DESCRIPTION).toContain("which constraint breaks the tie?")
  })

  it("asks the executor to call the advisor on its own", () => {
    expect(ADVISOR_TOOL_DESCRIPTION).toContain("Call advisor on its own")
  })

  it("puts the word limit into the advisor system prompt", () => {
    const prompt = advisorSystemPrompt(120)
    expect(prompt).toContain("Keep it under 120 words.")
    expect(prompt).toContain("You cannot call tools.")
    expect(prompt).not.toContain("{{")
  })
})
