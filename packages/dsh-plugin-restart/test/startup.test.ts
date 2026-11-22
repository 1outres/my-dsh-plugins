import { describe, expect, it } from "vitest"
import type { LoggerPort, ResumeSessionPort } from "../src/contract"
import { startAfterStartup } from "../src/host/startup"

interface FixtureOptions {
  run?: (sessions: ResumeSessionPort) => Promise<void>
}

function createFixture(options: FixtureOptions = {}) {
  const readyListeners: (() => void)[] = []
  const sessionListeners: ((sessions: ResumeSessionPort) => void)[] = []
  const runs: ResumeSessionPort[] = []
  const warn: string[] = []
  const logger: LoggerPort = {
    info: () => {},
    warn: (message) => warn.push(message),
  }
  const sessions: ResumeSessionPort = {
    resolve: async () => ({ kind: "missing", reason: "none" }),
  }
  startAfterStartup({
    onReady: (listener) => {
      readyListeners.push(listener)
    },
    onSessions: (listener) => {
      sessionListeners.push(listener)
    },
    run:
      options.run ??
      (async (resolved) => {
        runs.push(resolved)
      }),
    logger,
  })
  return {
    runs,
    sessions,
    warn,
    commitReady() {
      for (const listener of [...readyListeners]) listener()
    },
    commitSessions() {
      for (const listener of [...sessionListeners]) listener(sessions)
    },
  }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe("startup trigger", () => {
  it("waits for readiness and the session controller", async () => {
    const fixture = createFixture()
    fixture.commitReady()
    await flush()
    expect(fixture.runs).toEqual([])
    fixture.commitSessions()
    await flush()
    expect(fixture.runs).toEqual([fixture.sessions])
  })

  it("runs when the signals arrive in the other order", async () => {
    const fixture = createFixture()
    fixture.commitSessions()
    await flush()
    expect(fixture.runs).toEqual([])
    fixture.commitReady()
    await flush()
    expect(fixture.runs).toEqual([fixture.sessions])
  })

  it("runs once even when a signal repeats", async () => {
    const fixture = createFixture()
    fixture.commitReady()
    fixture.commitReady()
    fixture.commitSessions()
    fixture.commitSessions()
    await flush()
    expect(fixture.runs).toHaveLength(1)
  })

  it("logs work that fails", async () => {
    const fixture = createFixture({
      run: async () => {
        throw new Error("storage is gone")
      },
    })
    fixture.commitReady()
    fixture.commitSessions()
    await flush()
    expect(fixture.warn.join(" ")).toContain("storage is gone")
  })
})
