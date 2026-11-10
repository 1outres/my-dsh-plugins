import { describe, expect, it, vi } from "vitest"
import type { ApprovalOutcomeLike, QuestionAnswerLike } from "../src/host/types"
import { SessionStatusWatcher, type WatcherContext } from "../src/host/watch"
import { diffStatus } from "../src/shared/notify"

interface FakeSession {
  readonly id: string
  readonly header: { readonly origin?: "subagent" }
}

function createHost(
  options: { titles?: Record<string, string>; sessions?: Record<string, FakeSession> } = {},
) {
  const listeners = new Map<string, ((...args: unknown[]) => unknown)[]>()
  const sessions = new Map<string, FakeSession>(
    Object.entries(options.sessions ?? {}).map(([id, session]) => [id, session]),
  )
  const titles = options.titles ?? {}
  for (const id of Object.keys(titles)) {
    if (!sessions.has(id)) sessions.set(id, { id, header: {} })
  }

  const ctx = {
    sessions: {
      get: (id: string) => sessions.get(id),
    },
    sessionTitle: {
      get: (session: unknown) => {
        const title = titles[(session as FakeSession).id]
        return title === undefined ? undefined : { title }
      },
    },
    on: (event: string, listener: (...args: unknown[]) => unknown) => {
      const list = listeners.get(event) ?? []
      list.push(listener)
      listeners.set(event, list)
      return () => {}
    },
  } as unknown as WatcherContext

  const emit = async (event: string, ...args: unknown[]): Promise<unknown> => {
    const listener = listeners.get(event)?.[0]
    if (listener === undefined) throw new Error(`no listener for ${event}`)
    return listener(...args)
  }

  const addSession = (id: string, header: FakeSession["header"] = {}) => {
    sessions.set(id, { id, header })
  }

  return { ctx, emit, sessions, addSession }
}

function approval(callId = "call-1") {
  return {
    agent: { id: "s1" },
    toolName: "bash",
    callId,
    reason: "escalate sandbox",
    displayReason: { en: "Needs write", ja: "書き込みが必要" },
  }
}

function question(intent?: { kind: string }) {
  return {
    agent: { id: "s1" },
    questions: [{ id: "q1", question: "Which branch?", header: "Branch", intent }],
  }
}

describe("SessionStatusWatcher", () => {
  it("publishes the running state of a Session", () => {
    const host = createHost()
    const watcher = new SessionStatusWatcher(host.ctx)
    watcher.attach()
    const listener = vi.fn()
    watcher.subscribe(listener)

    void host.emit("api-session/status", "s1", true)

    expect(watcher.getSnapshot().get("s1")?.running).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)

    void host.emit("api-session/status", "s1", false)
    expect(watcher.getSnapshot().get("s1")?.running).toBe(false)
  })

  it("reports a completion only after the watcher saw the Session running", () => {
    const host = createHost()
    const watcher = new SessionStatusWatcher(host.ctx)
    watcher.attach()
    void host.emit("api-session/status", "s1", true)
    const before = watcher.getSnapshot()
    void host.emit("api-session/status", "s1", false)

    const diff = diffStatus(before, watcher.getSnapshot(), {
      approval: true,
      question: true,
      completion: true,
    })
    expect(diff.opened).toHaveLength(1)
    expect(diff.opened[0]).toMatchObject({ sessionId: "s1", kind: "completion" })
  })

  it("keeps an approval pending until next() settles and returns its result", async () => {
    const host = createHost({ titles: { s1: "Fix login" } })
    const watcher = new SessionStatusWatcher(host.ctx)
    watcher.attach()
    let settle: (outcome: ApprovalOutcomeLike) => void = () => {}
    const next = vi.fn(
      () =>
        new Promise<ApprovalOutcomeLike>((resolve) => {
          settle = resolve
        }),
    )

    const result = host.emit("approval/request", approval(), next)

    expect(watcher.getSnapshot().get("s1")?.pendingInteraction).toMatchObject({
      key: "approval:call-1",
      kind: "approval",
      toolName: "bash",
      reason: "escalate sandbox",
    })
    settle("allowed-once")
    await expect(result).resolves.toBe("allowed-once")
    expect(watcher.getSnapshot().get("s1")?.pendingInteraction).toBeUndefined()
    expect(watcher.titleOf("s1")).toBe("Fix login")
  })

  it("forwards the rejection of next()", async () => {
    const host = createHost()
    const watcher = new SessionStatusWatcher(host.ctx)
    watcher.attach()
    const failure = new Error("answerer failed")
    const next = vi.fn(async (): Promise<ApprovalOutcomeLike> => {
      throw failure
    })

    await expect(host.emit("approval/request", approval(), next)).rejects.toBe(failure)
    expect(watcher.getSnapshot().get("s1")?.pendingInteraction).toBeUndefined()
  })

  it("maps question intents onto the notification kinds", async () => {
    const host = createHost()
    const watcher = new SessionStatusWatcher(host.ctx)
    watcher.attach()
    const next = vi.fn(async (): Promise<QuestionAnswerLike> => ({ answers: [] }))

    void host.emit("user-questions/request", question({ kind: "plan-review" }), next)
    expect(watcher.getSnapshot().get("s1")?.pendingInteraction?.kind).toBe("plan-review")
    expect(watcher.getSnapshot().get("s1")?.pendingInteraction?.questions).toEqual([
      { question: "Which branch?", header: "Branch" },
    ])

    void host.emit("user-questions/request", question({ kind: "approval" }), next)
    expect(watcher.getSnapshot().get("s1")?.pendingInteraction?.kind).toBe("approval")

    void host.emit("user-questions/request", question(), next)
    expect(watcher.getSnapshot().get("s1")?.pendingInteraction?.kind).toBe("question")
  })

  it("ignores a question request without an agent but still delegates", async () => {
    const host = createHost()
    const watcher = new SessionStatusWatcher(host.ctx)
    watcher.attach()
    const next = vi.fn(async (): Promise<QuestionAnswerLike> => ({ answers: [] }))

    await host.emit("user-questions/request", { questions: [] }, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(watcher.getSnapshot().size).toBe(0)
  })

  it("publishes the most recently opened interaction of a Session", async () => {
    const host = createHost()
    const watcher = new SessionStatusWatcher(host.ctx)
    watcher.attach()
    let settleApproval: (outcome: ApprovalOutcomeLike) => void = () => {}
    const approvalDone = new Promise<ApprovalOutcomeLike>((resolve) => {
      settleApproval = resolve
    })
    let settleQuestion: () => void = () => {}
    const questionDone = new Promise<void>((resolve) => {
      settleQuestion = resolve
    })
    const nextApproval = vi.fn(() => approvalDone)
    const nextQuestion = vi.fn(async (): Promise<QuestionAnswerLike> => {
      await questionDone
      return { answers: [] }
    })

    const approvalResult = host.emit("approval/request", approval(), nextApproval)
    const questionResult = host.emit("user-questions/request", question(), nextQuestion)

    expect(watcher.getSnapshot().get("s1")?.pendingInteraction?.kind).toBe("question")

    settleQuestion()
    await questionResult
    expect(watcher.getSnapshot().get("s1")?.pendingInteraction?.kind).toBe("approval")

    settleApproval("allowed-once")
    await approvalResult
    expect(watcher.getSnapshot().get("s1")?.pendingInteraction).toBeUndefined()
  })

  it("excludes subagent Sessions and still delegates", async () => {
    const host = createHost({ sessions: { sub: { id: "sub", header: { origin: "subagent" } } } })
    const watcher = new SessionStatusWatcher(host.ctx)
    watcher.attach()
    const next = vi.fn(async (): Promise<ApprovalOutcomeLike> => "rejected")

    await host.emit("approval/request", { ...approval(), agent: { id: "sub" } }, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(watcher.getSnapshot().size).toBe(0)
  })

  it("drops a removed Session and closes its pending notifications", async () => {
    const host = createHost()
    const watcher = new SessionStatusWatcher(host.ctx)
    watcher.attach()
    void host.emit("approval/request", approval(), async () => "allowed-once")
    const before = watcher.getSnapshot()

    void host.emit("api-session/removed", "s1")

    expect(watcher.getSnapshot().has("s1")).toBe(false)
    const diff = diffStatus(before, watcher.getSnapshot(), {
      approval: true,
      question: true,
      completion: true,
    })
    expect(diff.closed).toEqual(["dsh-notify:approval:s1"])
  })

  it("uses an empty title when the Session is not live", () => {
    const host = createHost()
    const watcher = new SessionStatusWatcher(host.ctx)
    watcher.attach()

    expect(watcher.titleOf("gone")).toBe("")
  })

  it("never reports an unread completion", () => {
    const host = createHost()
    const watcher = new SessionStatusWatcher(host.ctx)
    watcher.attach()
    void host.emit("api-session/status", "s1", true)

    expect(watcher.getSnapshot().get("s1")?.completionUnread).toBe(false)
  })
})
