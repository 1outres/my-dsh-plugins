import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "../src/client/config"
import { apply } from "../src/client/index"
import type {
  ClientContext,
  NotifyConfig,
  SessionStatusLike,
  SessionStatusMap,
} from "../src/client/types"

interface FakeOptions {
  body?: string
  tag?: string
}

class FakeNotification {
  static permission: NotificationPermission = "granted"
  static requests = 0
  static instances: FakeNotification[] = []

  static async requestPermission(): Promise<NotificationPermission> {
    FakeNotification.requests += 1
    return FakeNotification.permission
  }

  readonly title: string
  readonly options: FakeOptions
  onclick: (() => void) | null = null
  onclose: (() => void) | null = null
  closed = false

  constructor(title: string, options: FakeOptions = {}) {
    this.title = title
    this.options = options
    FakeNotification.instances.push(this)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.onclose?.()
  }

  click(): void {
    this.onclick?.()
  }
}

function approval(key = "approval:1"): SessionStatusLike["pendingInteraction"] {
  return { key, kind: "approval", toolName: "bash", reason: "escalate sandbox" }
}

function createHarness(
  options: {
    config?: Partial<NotifyConfig>
    visible?: boolean
    focused?: boolean
    rows?: Record<string, { title?: string; displayTitle?: string; origin?: string }>
  } = {},
) {
  let config: Partial<NotifyConfig> = options.config ?? {}
  const listeners = new Set<() => void>()
  let snapshot: SessionStatusMap = new Map()
  const opened: string[] = []
  const effects: (() => void)[] = []
  const registrations: { id?: string; name: string }[] = []
  const rows = options.rows ?? { s1: { title: "Fix login", displayTitle: "Fix login" } }

  const form = {
    getSnapshot: () => ({
      status: "ready" as const,
      value: { ...DEFAULT_CONFIG, ...config },
      revision: 1,
      writable: true,
    }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: async (field: string, value: unknown) => {
      config = { ...config, [field]: value }
      for (const listener of listeners) listener()
      return true
    },
    unset: async () => true,
  }

  const ctx = {
    effect: (effect: () => (() => void) | undefined) => {
      const dispose = effect()
      if (typeof dispose === "function") effects.push(dispose)
    },
    sessions: { list: { getSnapshot: () => ({ ids: Object.keys(rows), byId: rows }) } },
    uiSession: {
      sessionStatus: {
        getSnapshot: () => snapshot,
        subscribe: (listener: () => void) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      },
    },
    uiWorkspace: { openSession: (id: string) => opened.push(id) },
    slots: {
      inject: (_key: string, register: () => () => void) => register(),
      register: (spec: { id?: string; name: string }) => {
        registrations.push(spec)
        return () => {}
      },
    },
    locale: {
      register: () => () => {},
      bind: () => (key: string) => key,
    },
    configForms: {
      get: () => form,
      whileServed: (_namespaces: string[], register: () => () => void) => register(),
    },
  }

  return {
    ctx: ctx as unknown as ClientContext,
    registrations,
    opened,
    push(next: Record<string, SessionStatusLike>) {
      snapshot = new Map(Object.entries(next))
      for (const listener of listeners) listener()
    },
    dispose() {
      for (const effect of effects.reverse()) effect()
    },
    savedConfig: () => config,
  }
}

interface StyleTag {
  dataset: Record<string, string>
  textContent: string
  removed: boolean
  remove(): void
}

let styleTags: StyleTag[] = []

function page(visible: boolean, focused: boolean) {
  styleTags = []
  vi.stubGlobal("document", {
    visibilityState: visible ? "visible" : "hidden",
    hasFocus: () => focused,
    createElement: () => {
      const tag: StyleTag = {
        dataset: {},
        textContent: "",
        removed: false,
        remove() {
          tag.removed = true
        },
      }
      return tag
    },
    head: {
      append: (tag: StyleTag) => {
        styleTags.push(tag)
      },
    },
  })
}

beforeEach(() => {
  FakeNotification.permission = "granted"
  FakeNotification.requests = 0
  FakeNotification.instances = []
  page(false, false)
  vi.stubGlobal("Notification", FakeNotification)
  vi.stubGlobal("window", { focus: vi.fn() })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("notify client half", () => {
  it("raises a notification for a pending approval", async () => {
    const harness = createHarness()
    apply(harness.ctx)
    harness.push({ s1: { running: true, completionUnread: false, pendingInteraction: approval() } })
    await Promise.resolve()

    expect(FakeNotification.instances).toHaveLength(1)
    const notification = FakeNotification.instances[0]
    expect(notification?.title).toBe("Approval needed")
    expect(notification?.options.body).toBe("Fix login · bash: escalate sandbox")
    expect(notification?.options.tag).toBe("dsh-notify:approval:s1")
  })

  it("stays quiet while the page is visible and focused", async () => {
    page(true, true)
    const harness = createHarness()
    apply(harness.ctx)
    harness.push({ s1: { running: true, completionUnread: false, pendingInteraction: approval() } })
    await Promise.resolve()

    expect(FakeNotification.instances).toHaveLength(0)
  })

  it("closes the notification when the approval resolves", async () => {
    const harness = createHarness()
    apply(harness.ctx)
    harness.push({ s1: { running: true, completionUnread: false, pendingInteraction: approval() } })
    await Promise.resolve()

    harness.push({ s1: { running: true, completionUnread: false } })
    await Promise.resolve()

    expect(FakeNotification.instances[0]?.closed).toBe(true)
  })

  it("opens the Session when the notification is clicked", async () => {
    const harness = createHarness()
    apply(harness.ctx)
    harness.push({ s1: { running: true, completionUnread: false, pendingInteraction: approval() } })
    await Promise.resolve()

    FakeNotification.instances[0]?.click()

    expect(harness.opened).toEqual(["s1"])
    expect(FakeNotification.instances[0]?.closed).toBe(true)
  })

  it("does nothing when notifications are disabled", async () => {
    const harness = createHarness({ config: { enabled: false } })
    apply(harness.ctx)
    harness.push({ s1: { running: true, completionUnread: false, pendingInteraction: approval() } })
    await Promise.resolve()

    expect(FakeNotification.instances).toHaveLength(0)
  })

  it("asks for permission once per page load", async () => {
    FakeNotification.permission = "default"
    const harness = createHarness()
    apply(harness.ctx)
    harness.push({
      s1: { running: true, completionUnread: false, pendingInteraction: approval("a1") },
    })
    harness.push({
      s1: { running: true, completionUnread: false, pendingInteraction: approval("a2") },
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(FakeNotification.requests).toBe(1)
    expect(FakeNotification.instances).toHaveLength(0)
  })

  it("skips subagent Sessions", async () => {
    const harness = createHarness({
      rows: { sub: { title: "Child", displayTitle: "Child", origin: "subagent" } },
    })
    apply(harness.ctx)
    harness.push({
      sub: { running: true, completionUnread: false, pendingInteraction: approval() },
    })
    await Promise.resolve()

    expect(FakeNotification.instances).toHaveLength(0)
  })

  it("reports a finished turn", async () => {
    const harness = createHarness()
    apply(harness.ctx)
    harness.push({ s1: { running: true, completionUnread: false } })
    harness.push({ s1: { running: false, completionUnread: false } })
    await Promise.resolve()

    expect(FakeNotification.instances).toHaveLength(1)
    expect(FakeNotification.instances[0]?.title).toBe("Turn finished")
    expect(FakeNotification.instances[0]?.options.body).toBe("Fix login")
  })

  it("keeps every notification closed on teardown", async () => {
    const harness = createHarness()
    apply(harness.ctx)
    harness.push({ s1: { running: true, completionUnread: false, pendingInteraction: approval() } })
    await Promise.resolve()

    harness.dispose()

    expect(FakeNotification.instances[0]?.closed).toBe(true)
  })

  it("registers the settings section under the notify id", () => {
    const harness = createHarness()
    apply(harness.ctx)

    expect(harness.registrations.some((entry) => entry.id === "notify")).toBe(true)
  })

  it("injects and removes the switch stylesheet", () => {
    const harness = createHarness()
    apply(harness.ctx)

    expect(styleTags).toHaveLength(1)
    expect(styleTags[0]?.dataset.plugin).toBe("@1outres/dsh-plugin-notify")
    expect(styleTags[0]?.textContent).toContain(".dsh-notify-switch")

    harness.dispose()

    expect(styleTags[0]?.removed).toBe(true)
  })
})
