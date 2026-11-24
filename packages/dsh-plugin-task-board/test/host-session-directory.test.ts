import { describe, expect, it } from "vitest"
import { createSessionDirectory, type SessionDirectoryPorts } from "../src/host/session-directory"

interface FakeSession {
  readonly id: string
}

interface FakeAgent {
  readonly id: string
}

function createPorts(
  options: {
    sessions?: readonly FakeSession[]
    agents?: readonly FakeAgent[]
    roots?: Record<string, string>
    failure?: Error
  } = {},
) {
  const sessions = new Map<string, FakeSession>(
    (options.sessions ?? []).map((session) => [session.id, session]),
  )
  const agents = new Map<string, FakeAgent>(
    (options.agents ?? []).map((agent) => [agent.id, agent]),
  )
  const roots = options.roots ?? {}
  const inspected: string[] = []
  const ports: SessionDirectoryPorts = {
    sessionQuery: {
      inspectSession: async <T>(sessionId: string, read: (session: never) => T): Promise<T> => {
        inspected.push(sessionId)
        if (options.failure !== undefined) throw options.failure
        const session = sessions.get(sessionId)
        if (session === undefined) throw new Error(`Session ${sessionId} is not available.`)
        return read(session as never)
      },
    },
    workingDirectory: { get: (session) => `/work/${(session as unknown as FakeSession).id}` },
    agents: { get: (sessionId) => agents.get(sessionId) as never },
    subagents: {
      rootOf: (agent) =>
        agents.get(
          roots[(agent as unknown as FakeAgent).id] ?? (agent as unknown as FakeAgent).id,
        ) as never,
    },
  }
  return { ports, inspected, sessions, agents }
}

describe("createSessionDirectory", () => {
  it("reads the working directory of a session", async () => {
    const harness = createPorts({ sessions: [{ id: "s1" }] })
    const directory = createSessionDirectory(harness.ports)

    await expect(directory.directoryOf("s1")).resolves.toBe("/work/s1")
    expect(harness.inspected).toEqual(["s1"])
  })

  it("propagates a session that cannot be inspected", async () => {
    const harness = createPorts()
    const directory = createSessionDirectory(harness.ports)

    await expect(directory.directoryOf("missing")).rejects.toThrow(
      "Session missing is not available.",
    )
  })

  it("propagates an inspection failure", async () => {
    const failure = new Error("storage is down")
    const harness = createPorts({ failure })
    const directory = createSessionDirectory(harness.ports)

    await expect(directory.directoryOf("s1")).rejects.toBe(failure)
  })

  it("treats a session without a live agent as its own root", () => {
    const harness = createPorts()
    const directory = createSessionDirectory(harness.ports)

    expect(directory.rootSessionOf("s1")).toBe("s1")
  })

  it("uses the subagent root of a live agent", () => {
    const harness = createPorts({
      agents: [{ id: "root" }, { id: "child" }],
      roots: { child: "root" },
    })
    const directory = createSessionDirectory(harness.ports)

    expect(directory.rootSessionOf("child")).toBe("root")
    expect(directory.rootSessionOf("root")).toBe("root")
  })
})
