import { describe, expect, it } from "vitest"
import type {
  LoggerPort,
  ResolvedSession,
  ResumeRecord,
  ResumeSessionPort,
  ResumeStore,
} from "../src/contract"
import { resumeAfterStartup, resumeMessage } from "../src/host/resume"

interface FixtureOptions {
  record?: ResumeRecord
  now?: number
  session?: ResolvedSession
  withinMinutes?: number
}

function createFixture(options: FixtureOptions = {}) {
  const record = options.record
  const calls = { clear: 0, resolve: [] as string[] }
  const delivered: string[] = []
  const info: string[] = []
  const warn: string[] = []
  const logger: LoggerPort = {
    info: (message) => info.push(message),
    warn: (message) => warn.push(message),
  }
  const store: ResumeStore = {
    read: () => record,
    save: async () => {},
    clear: async () => {
      calls.clear += 1
      return record !== undefined
    },
  }
  const session: ResolvedSession = options.session ?? {
    kind: "found",
    deliver: { followup: (text: string) => delivered.push(text) },
  }
  const sessions: ResumeSessionPort = {
    resolve: async (sessionId) => {
      calls.resolve.push(sessionId)
      return session
    },
  }
  const run = () =>
    resumeAfterStartup({
      store,
      sessions,
      clock: () => options.now ?? 2_000,
      withinMinutes: options.withinMinutes ?? 10,
      logger,
    })
  return { run, calls, delivered, info, warn, record }
}

describe("resume after startup", () => {
  it("does nothing when no restart was stored", async () => {
    const fixture = createFixture()
    expect(await fixture.run()).toEqual({ kind: "none" })
    expect(fixture.calls.clear).toBe(0)
    expect(fixture.delivered).toEqual([])
  })

  it("drops the record before it reads the clock or the session", async () => {
    const fixture = createFixture({
      record: { sessionId: "s1", requestedAt: 1_000 },
      now: 1_000 + 11 * 60_000,
    })
    expect(await fixture.run()).toEqual({
      kind: "expired",
      record: { sessionId: "s1", requestedAt: 1_000 },
    })
    expect(fixture.calls.clear).toBe(1)
    expect(fixture.calls.resolve).toEqual([])
    expect(fixture.warn.join(" ")).toContain("s1")
  })

  it("keeps a record that is exactly at the edge of the window", async () => {
    const fixture = createFixture({
      record: { sessionId: "s1", requestedAt: 1_000 },
      now: 1_000 + 10 * 60_000,
    })
    expect(await fixture.run()).toMatchObject({ kind: "resumed" })
    expect(fixture.calls.resolve).toEqual(["s1"])
  })

  it("wakes the session with the time, the note and the next step", async () => {
    const fixture = createFixture({
      record: {
        sessionId: "s1",
        note: "run the tests",
        requestedAt: Date.parse("2026-11-22T23:55:00.000Z"),
      },
      now: Date.parse("2026-11-23T00:00:00.000Z"),
    })
    expect(await fixture.run()).toMatchObject({ kind: "resumed" })
    expect(fixture.delivered).toHaveLength(1)
    const text = fixture.delivered[0] ?? ""
    expect(text).toContain("2026-11-23T00:00:00.000Z")
    expect(text).toContain("run the tests")
    expect(text).toMatch(/Continue the task/)
    expect(fixture.info.join(" ")).toContain("s1")
  })

  it("leaves an empty note out of the message", async () => {
    expect(resumeMessage({ sessionId: "s1", note: "  ", requestedAt: 1 }, "now")).not.toContain(
      "What you wrote",
    )
    expect(resumeMessage({ sessionId: "s1", requestedAt: 1 }, "now")).not.toContain(
      "What you wrote",
    )
  })

  it("logs a session it cannot resolve", async () => {
    const fixture = createFixture({
      record: { sessionId: "s1", requestedAt: 1_000 },
      session: { kind: "missing", reason: "session was deleted" },
    })
    expect(await fixture.run()).toEqual({
      kind: "missing",
      record: { sessionId: "s1", requestedAt: 1_000 },
      reason: "session was deleted",
    })
    expect(fixture.delivered).toEqual([])
    expect(fixture.warn.join(" ")).toContain("session was deleted")
  })
})
