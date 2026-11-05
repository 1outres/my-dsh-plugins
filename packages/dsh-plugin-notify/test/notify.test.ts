import { describe, expect, it } from "vitest"
import { DEFAULT_CONFIG, normalizeConfig } from "../src/client/config"
import {
  diffStatus,
  formatNotice,
  kindOf,
  noticeTag,
  shouldNotify,
  truncate,
} from "../src/client/notify"
import type { SessionStatusLike, SessionStatusMap } from "../src/client/types"

const ALL = { approval: true, question: true, completion: true }

function status(overrides: Partial<SessionStatusLike> = {}): SessionStatusLike {
  return { running: false, completionUnread: false, ...overrides }
}

function map(entries: Record<string, SessionStatusLike>): SessionStatusMap {
  return new Map(Object.entries(entries))
}

function approval(key = "approval:1", extra: Record<string, unknown> = {}) {
  return { key, kind: "approval", toolName: "bash", reason: "escalate sandbox", ...extra }
}

describe("diffStatus", () => {
  it("opens an approval that was not pending before", () => {
    const diff = diffStatus(undefined, map({ s1: status({ pendingInteraction: approval() }) }), ALL)

    expect(diff.opened).toHaveLength(1)
    expect(diff.opened[0]).toMatchObject({
      sessionId: "s1",
      kind: "approval",
      toolName: "bash",
      reason: "escalate sandbox",
    })
    expect(diff.closed).toEqual([])
  })

  it("does not repeat an unchanged request", () => {
    const previous = map({ s1: status({ pendingInteraction: approval() }) })
    const next = map({ s1: status({ pendingInteraction: approval() }) })

    expect(diffStatus(previous, next, ALL).opened).toEqual([])
  })

  it("closes the notification once the request is answered", () => {
    const previous = map({ s1: status({ pendingInteraction: approval() }) })
    const next = map({ s1: status() })

    const diff = diffStatus(previous, next, ALL)
    expect(diff.opened).toEqual([])
    expect(diff.closed).toEqual([noticeTag("s1", "approval")])
  })

  it("carries the first question text", () => {
    const previous = map({ s1: status() })
    const next = map({
      s1: status({
        pendingInteraction: {
          key: "question:1",
          kind: "question",
          questions: [{ question: "Which branch?" }, { question: "Why?" }],
        },
      }),
    })

    const diff = diffStatus(previous, next, ALL)
    expect(diff.opened[0]).toMatchObject({ kind: "question", question: "Which branch?" })
  })

  it("gates plan reviews behind the question toggle", () => {
    const previous = map({ s1: status() })
    const next = map({ s1: status({ pendingInteraction: { key: "plan:1", kind: "plan-review" } }) })

    expect(diffStatus(previous, next, { ...ALL, question: false }).opened).toEqual([])
    expect(diffStatus(previous, next, ALL).opened[0]?.kind).toBe("plan-review")
  })

  it("ignores disabled kinds but still closes them", () => {
    const previous = map({ s1: status({ pendingInteraction: approval() }) })
    const next = map({ s1: status({ pendingInteraction: approval("approval:2") }) })

    expect(diffStatus(previous, next, { ...ALL, approval: false }).opened).toEqual([])

    const resolved = diffStatus(previous, map({ s1: status() }), { ...ALL, approval: false })
    expect(resolved.closed).toEqual([noticeTag("s1", "approval")])
  })

  it("replaces a request whose key changed under the same kind", () => {
    const previous = map({ s1: status({ pendingInteraction: approval("approval:1") }) })
    const next = map({ s1: status({ pendingInteraction: approval("approval:2") }) })

    const diff = diffStatus(previous, next, ALL)
    expect(diff.opened).toHaveLength(1)
    expect(diff.closed).toEqual([])
  })

  it("closes the old kind when a different request replaces it", () => {
    const previous = map({ s1: status({ pendingInteraction: approval() }) })
    const next = map({
      s1: status({ pendingInteraction: { key: "question:1", kind: "question" } }),
    })

    const diff = diffStatus(previous, next, ALL)
    expect(diff.closed).toEqual([noticeTag("s1", "approval")])
    expect(diff.opened[0]?.kind).toBe("question")
  })

  it("reports a turn that stopped running", () => {
    const previous = map({ s1: status({ running: true }) })
    const next = map({ s1: status({ running: false }) })

    const diff = diffStatus(previous, next, ALL)
    expect(diff.opened).toHaveLength(1)
    expect(diff.opened[0]).toMatchObject({ sessionId: "s1", kind: "completion" })
  })

  it("does not replay a backlog of finished turns on the first snapshot", () => {
    const first = diffStatus(undefined, map({ s1: status({ running: false }) }), ALL)
    expect(first.opened).toEqual([])

    const unread = diffStatus(
      undefined,
      map({ s1: status({ running: false, completionUnread: true }) }),
      ALL,
    )
    expect(unread.opened).toEqual([])
  })

  it("reports a completion that only appears as unread", () => {
    const previous = map({ s1: status({ running: true, completionUnread: false }) })
    const next = map({ s1: status({ running: false, completionUnread: true }) })

    expect(diffStatus(previous, next, ALL).opened).toHaveLength(1)
  })

  it("closes notifications of a Session that left the snapshot", () => {
    const previous = map({ s1: status({ pendingInteraction: approval() }) })
    const next = map({})

    expect(diffStatus(previous, next, ALL).closed).toEqual([noticeTag("s1", "approval")])
  })

  it("filters Sessions through notifySession", () => {
    const next = map({ sub: status({ pendingInteraction: approval() }) })
    const diff = diffStatus(undefined, next, { ...ALL, notifySession: (id) => id !== "sub" })

    expect(diff.opened).toEqual([])
  })

  it("ignores unknown interaction kinds", () => {
    const pending = { key: "mystery:1", kind: "mystery" }
    expect(kindOf(pending)).toBeUndefined()
    expect(
      diffStatus(undefined, map({ s1: status({ pendingInteraction: pending }) }), ALL).opened,
    ).toEqual([])
  })
})

describe("shouldNotify", () => {
  it("obeys the master switch", () => {
    expect(
      shouldNotify({ ...DEFAULT_CONFIG, enabled: false }, { visible: false, focused: false }),
    ).toBe(false)
  })

  it("stays quiet while the page is visible and focused", () => {
    expect(shouldNotify(DEFAULT_CONFIG, { visible: true, focused: true })).toBe(false)
  })

  it("notifies a hidden or unfocused page", () => {
    expect(shouldNotify(DEFAULT_CONFIG, { visible: false, focused: true })).toBe(true)
    expect(shouldNotify(DEFAULT_CONFIG, { visible: true, focused: false })).toBe(true)
  })

  it("always notifies when the focus guard is off", () => {
    const config = { ...DEFAULT_CONFIG, onlyWhenUnfocused: false }
    expect(shouldNotify(config, { visible: true, focused: true })).toBe(true)
  })
})

describe("formatNotice", () => {
  const base = { sessionId: "s1", key: "k" } as const

  it("titles each kind", () => {
    expect(
      formatNotice({ ...base, kind: "approval" }, "Fix login", { showDetail: true }).title,
    ).toBe("Approval needed")
    expect(
      formatNotice({ ...base, kind: "completion" }, "Fix login", { showDetail: true }).title,
    ).toBe("Turn finished")
  })

  it("joins the Session title, tool and reason", () => {
    const spec = formatNotice(
      { ...base, kind: "approval", toolName: "bash", reason: "escalate sandbox" },
      "Fix login",
      { showDetail: true },
    )
    expect(spec.body).toBe("Fix login · bash: escalate sandbox")
  })

  it("prefers the localized display reason", () => {
    const spec = formatNotice(
      {
        ...base,
        kind: "approval",
        toolName: "bash",
        reason: "raw",
        displayReason: { en: "Needs write" },
      },
      "Fix login",
      { showDetail: true },
    )
    expect(spec.body).toBe("Fix login · bash: Needs write")
  })

  it("hides detail when the setting is off", () => {
    const spec = formatNotice(
      { ...base, kind: "question", question: "Which branch?" },
      "Fix login",
      {
        showDetail: false,
      },
    )
    expect(spec.body).toBe("Fix login")
  })

  it("falls back when the Session has no title", () => {
    expect(formatNotice({ ...base, kind: "completion" }, "   ", { showDetail: true }).body).toBe(
      "DeepSeek Harness",
    )
  })

  it("collapses whitespace and truncates long detail", () => {
    const spec = formatNotice(
      { ...base, kind: "question", question: "a\nb ".repeat(80) },
      "Fix login",
      { showDetail: true },
    )
    expect(spec.body.endsWith("…")).toBe(true)
    expect(spec.body.length).toBeLessThanOrEqual(180)
    expect(spec.body).not.toContain("\n")
  })
})

describe("truncate", () => {
  it("keeps short text and cuts long text", () => {
    expect(truncate("hello", 10)).toBe("hello")
    expect(truncate("hello world", 5)).toBe("hell…")
  })
})

describe("normalizeConfig", () => {
  it("fills every missing field from the defaults", () => {
    expect(normalizeConfig(undefined)).toEqual(DEFAULT_CONFIG)
    expect(normalizeConfig({ enabled: false, approval: false })).toEqual({
      ...DEFAULT_CONFIG,
      enabled: false,
      approval: false,
    })
  })
})
