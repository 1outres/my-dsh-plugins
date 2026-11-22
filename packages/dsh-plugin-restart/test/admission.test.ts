import { describe, expect, it } from "vitest"
import {
  callerRefusal,
  cancelledMessage,
  describeRunningSessions,
  isRestartOffered,
  runningRefusal,
} from "../src/host/admission"

const presets = ["cordis", "creator-ptc"]

function facts(overrides: { agentId?: string; rootAgentId?: string; preset?: string } = {}) {
  return { agentId: "a1", rootAgentId: "a1", preset: "cordis", ...overrides }
}

describe("restart admission", () => {
  it("offers the tool to a root Creator agent", () => {
    expect(isRestartOffered(facts(), presets)).toBe(true)
  })

  it("offers nothing to a sub-agent", () => {
    expect(isRestartOffered(facts({ rootAgentId: "root" }), presets)).toBe(false)
  })

  it("offers nothing to another preset", () => {
    expect(isRestartOffered(facts({ preset: "standard" }), presets)).toBe(false)
    expect(isRestartOffered(facts({ preset: undefined }), presets)).toBe(false)
  })

  it("explains a sub-agent refusal", () => {
    expect(callerRefusal(facts({ rootAgentId: "root" }), presets)).toMatch(/sub-agent/)
  })

  it("explains a preset refusal", () => {
    expect(callerRefusal(facts({ preset: "standard" }), presets)).toContain("standard")
    expect(callerRefusal(facts({ preset: undefined }), presets)).toContain("no agent preset")
  })

  it("accepts an admitted caller", () => {
    expect(callerRefusal(facts(), presets)).toBeUndefined()
  })

  it("names every running session and its title", () => {
    expect(
      describeRunningSessions([{ sessionId: "s2", title: "Fix the build" }, { sessionId: "s3" }]),
    ).toBe('s2 ("Fix the build"), s3')
  })

  it("tells the model which sessions block a restart", () => {
    expect(runningRefusal([{ sessionId: "s2", title: "Fix the build" }])).toBe(
      'Cannot restart DeepSeek Harness while other sessions are running: s2 ("Fix the build"). Stop them first.',
    )
  })

  it("explains a cancelled restart", () => {
    const message = cancelledMessage([{ sessionId: "s2" }])
    expect(message).toMatch(/cancelled/)
    expect(message).toContain("s2")
  })
})
