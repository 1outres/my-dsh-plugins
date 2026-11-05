import { describe, expect, it } from "vitest"
import { durableEvents, forkBoundary } from "../src/client/boundary"
import type { SessionEvent } from "../src/client/types"

/** Build a contiguous log from event types, starting at `base`. */
function log(types: (string | SessionEvent)[], base = 0): SessionEvent[] {
  return types.map((type, index) =>
    typeof type === "string"
      ? {
          type,
          seq: base + index,
          ...(type === "user/message" ? { surfaceOp: "append" } : {}),
        }
      : { ...type, seq: base + index },
  )
}

const SETUP = ["permission/preset", "sandbox/mode", "approval/policy", "agent-preset/selected"]

/** Turn 1 then turn 2, as a real Session logs them. */
const TWO_TURNS = log([
  ...SETUP, // 0-3
  "agent/inbox/spliced", // 4: prompt 1 queued
  "turn/start", // 5
  "agent/inbox/spliced", // 6: claimed
  "step/start", // 7
  "user/message", // 8
  "assistant/message", // 9
  "step/end", // 10
  "turn/end", // 11
  "workspace/changes", // 12
  "session/title", // 13
  "agent/inbox/spliced", // 14: prompt 2 queued
  "turn/start", // 15
  "agent/inbox/spliced", // 16
  "step/start", // 17
  "user/message", // 18
])

describe("forkBoundary", () => {
  it("cuts after the previous turn and its standalone events", () => {
    expect(forkBoundary(TWO_TURNS, 2, 15)).toEqual({ kind: "cut", seq: 13 })
  })

  it("keeps only the setup events when editing the first prompt", () => {
    expect(forkBoundary(TWO_TURNS, 1, 5)).toEqual({ kind: "cut", seq: 3 })
  })

  it("stops at a prompt queued while the previous turn was still running", () => {
    const events = log([
      ...SETUP,
      "agent/inbox/spliced", // 4
      "turn/start", // 5
      "agent/inbox/spliced", // 6
      "step/start", // 7
      "user/message", // 8
      "agent/inbox/spliced", // 9: prompt 2 queued mid-turn
      "assistant/message", // 10
      "step/end", // 11
      "turn/end", // 12
      "turn/start", // 13
    ])
    expect(forkBoundary(events, 2, 13)).toEqual({ kind: "cut", seq: 12 })
  })

  it("keeps a compaction checkpoint between turns with the prefix", () => {
    const events = log([
      ...SETUP,
      "turn/start", // 4
      "turn/end", // 5
      "compaction/start", // 6
      { type: "user/message", seq: 0, surfaceOp: { op: "replace", startSeq: 4, endSeq: 5 } }, // 7
      "compaction/end", // 8
      "agent/inbox/spliced", // 9
      "turn/start", // 10
    ])
    expect(forkBoundary(events, 2, 10)).toEqual({ kind: "cut", seq: 8 })
  })

  it("asks for older history when the window starts at this turn", () => {
    expect(forkBoundary(TWO_TURNS.slice(15), 2, 15)).toEqual({ kind: "load", through: 14 })
  })

  it("asks for the start of the log when the first turn's setup is not loaded", () => {
    expect(forkBoundary(TWO_TURNS.slice(2), 1, 5)).toEqual({ kind: "load", through: 0 })
  })

  it("rejects a later turn whose loaded history has no previous turn end", () => {
    const events = log([...SETUP, "agent/inbox/spliced", "turn/start"])
    expect(forkBoundary(events, 3, 5)).toEqual({ kind: "invalid" })
  })

  it("rejects a log with nothing to keep before the first turn", () => {
    expect(forkBoundary(log(["turn/start", "user/message"]), 1, 0)).toEqual({ kind: "invalid" })
  })
})

describe("durableEvents", () => {
  it("drops client-only live chunks", () => {
    const event = { type: "turn/start", seq: 1 }
    expect(
      durableEvents([
        { type: "event", event },
        { type: "transient", event: { type: "assistant/live-chunk" } },
      ]),
    ).toEqual([event])
  })
})
