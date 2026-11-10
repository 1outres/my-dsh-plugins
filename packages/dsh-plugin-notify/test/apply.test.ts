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
  data?: unknown
  renotify?: boolean
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

interface FakeSubscription {
  readonly endpoint: string
  readonly options: { applicationServerKey: ArrayBuffer | null }
  getKey(name: "p256dh" | "auth"): ArrayBuffer | null
  unsubscribe(): Promise<boolean>
}

function fakeSubscription(endpoint = "https://push.example.com/device"): FakeSubscription {
  return {
    endpoint,
    options: { applicationServerKey: null },
    getKey: (name) => new Uint8Array(name === "p256dh" ? 65 : 16).buffer,
    unsubscribe: vi.fn(async () => true),
  }
}

interface FakeRegistration {
  showNotification: ReturnType<typeof vi.fn>
  getNotifications: ReturnType<typeof vi.fn>
  pushManager: {
    getSubscription(): Promise<FakeSubscription | null>
    subscribe(options: unknown): Promise<FakeSubscription>
  }
}

function fakeRegistration(subscription: FakeSubscription | null = null): FakeRegistration {
  return {
    showNotification: vi.fn(async () => {}),
    getNotifications: vi.fn(async () => []),
    pushManager: {
      getSubscription: async () => subscription,
      subscribe: vi.fn(async () => fakeSubscription()),
    },
  }
}

interface FakeWorker {
  readonly controller: unknown
  readonly ready: Promise<unknown>
  addEventListener(type: string, listener: (event: MessageEvent) => void): void
  removeEventListener(type: string, listener: (event: MessageEvent) => void): void
  emit(data: unknown): void
}

function fakeWorker(registration: FakeRegistration = fakeRegistration()): FakeWorker {
  const listeners = new Set<(event: MessageEvent) => void>()
  return {
    controller: {},
    ready: Promise.resolve(registration),
    addEventListener: (type, listener) => {
      if (type === "message") listeners.add(listener)
    },
    removeEventListener: (type, listener) => {
      if (type === "message") listeners.delete(listener)
    },
    emit: (data) => {
      for (const listener of [...listeners]) listener({ data } as MessageEvent)
    },
  }
}

interface FakePushRemote {
  readonly subscribes: {
    endpoint: string
    p256dh: string
    auth: string
    label: string
  }[]
  publicKey(): Promise<{ ok: true; value: { publicKey: string } }>
  subscribe(input: {
    endpoint: string
    p256dh: string
    auth: string
    label: string
  }): Promise<{ ok: true; value: { id: string } }>
  unsubscribe(endpoint: string): Promise<{ ok: true; value: { removed: boolean } }>
  presence(
    endpoint: string,
    visible: boolean,
    focused: boolean,
  ): Promise<{ ok: true; value: { ok: true } }>
  status(endpoint: string): Promise<{ ok: true; value: { subscribed: boolean } }>
  test(endpoint: string): Promise<{ ok: true; value: { result: "sent" } }>
}

function fakePushRemote(): FakePushRemote {
  const subscribes: FakePushRemote["subscribes"] = []
  return {
    subscribes,
    publicKey: async () => ({ ok: true, value: { publicKey: "AQID" } }),
    subscribe: async (input) => {
      subscribes.push(input)
      return { ok: true, value: { id: "id" } }
    },
    unsubscribe: async () => ({ ok: true, value: { removed: true } }),
    presence: async () => ({ ok: true, value: { ok: true } }),
    status: async () => ({ ok: true, value: { subscribed: true } }),
    test: async () => ({ ok: true, value: { result: "sent" } }),
  }
}

function approval(key = "approval:1"): SessionStatusLike["pendingInteraction"] {
  return { key, kind: "approval", toolName: "bash", reason: "escalate sandbox" }
}

function createHarness(
  options: {
    config?: Partial<NotifyConfig>
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
  const pushRemote = fakePushRemote()
  const replaced: { url: string }[] = []

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
    get: (name: string) => (name === "remote.notifyPush" ? pushRemote : undefined),
    remote: { $mount: async () => async () => {} },
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
    pushRemote,
    registrations,
    opened,
    replaced,
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

interface PageOptions {
  url?: string
  worker?: FakeWorker
  pushManager?: boolean
  registration?: FakeRegistration
}

function page(visible: boolean, focused: boolean, options: PageOptions = {}) {
  styleTags = []
  const location = new URL(options.url ?? "https://dsh.example/")
  const replaceState = vi.fn()
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
  vi.stubGlobal("window", {
    focus: vi.fn(),
    location,
    history: { state: null, replaceState },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setInterval: vi.fn(() => 1),
    clearInterval: vi.fn(),
    matchMedia: vi.fn(() => ({ matches: false })),
  })
  vi.stubGlobal("navigator", {
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/120",
    platform: "Linux",
    maxTouchPoints: 0,
    serviceWorker: options.worker,
  })
  if (options.pushManager === true) vi.stubGlobal("PushManager", class {})
  return { replaceState, location }
}

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

beforeEach(() => {
  FakeNotification.permission = "granted"
  FakeNotification.requests = 0
  FakeNotification.instances = []
  page(false, false)
  vi.stubGlobal("Notification", FakeNotification)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("notify client half", () => {
  it("raises a notification for a pending approval", async () => {
    const harness = createHarness()
    await apply(harness.ctx)
    harness.push({ s1: { running: true, completionUnread: false, pendingInteraction: approval() } })
    await flush()

    expect(FakeNotification.instances).toHaveLength(1)
    const notification = FakeNotification.instances[0]
    expect(notification?.title).toBe("Approval needed")
    expect(notification?.options.body).toBe("Fix login · bash: escalate sandbox")
    expect(notification?.options.tag).toBe("dsh-notify:approval:s1")
    expect(notification?.options.data).toEqual({
      dshPwa: 1,
      openUrl: "./?dsh-notify-session=s1",
      payload: { sessionId: "s1" },
    })
  })

  it("stays quiet while the page is visible and focused", async () => {
    page(true, true)
    const harness = createHarness()
    await apply(harness.ctx)
    harness.push({ s1: { running: true, completionUnread: false, pendingInteraction: approval() } })
    await flush()

    expect(FakeNotification.instances).toHaveLength(0)
  })

  it("closes the notification when the approval resolves", async () => {
    const harness = createHarness()
    await apply(harness.ctx)
    harness.push({ s1: { running: true, completionUnread: false, pendingInteraction: approval() } })
    await flush()

    harness.push({ s1: { running: true, completionUnread: false } })
    await flush()

    expect(FakeNotification.instances[0]?.closed).toBe(true)
  })

  it("opens the Session when the notification is clicked", async () => {
    const harness = createHarness()
    await apply(harness.ctx)
    harness.push({ s1: { running: true, completionUnread: false, pendingInteraction: approval() } })
    await flush()

    FakeNotification.instances[0]?.click()

    expect(harness.opened).toEqual(["s1"])
    expect(FakeNotification.instances[0]?.closed).toBe(true)
  })

  it("does nothing when notifications are disabled", async () => {
    const harness = createHarness({ config: { enabled: false } })
    await apply(harness.ctx)
    harness.push({ s1: { running: true, completionUnread: false, pendingInteraction: approval() } })
    await flush()

    expect(FakeNotification.instances).toHaveLength(0)
  })

  it("asks for permission once per page load", async () => {
    FakeNotification.permission = "default"
    const harness = createHarness()
    await apply(harness.ctx)
    harness.push({
      s1: { running: true, completionUnread: false, pendingInteraction: approval("a1") },
    })
    harness.push({
      s1: { running: true, completionUnread: false, pendingInteraction: approval("a2") },
    })
    await flush()
    await flush()

    expect(FakeNotification.requests).toBe(1)
    // The sink does not gate on permission; the notification stays unsent until the page grants it.
    expect(FakeNotification.instances).toHaveLength(0)
  })

  it("skips subagent Sessions", async () => {
    const harness = createHarness({
      rows: { sub: { title: "Child", displayTitle: "Child", origin: "subagent" } },
    })
    await apply(harness.ctx)
    harness.push({
      sub: { running: true, completionUnread: false, pendingInteraction: approval() },
    })
    await flush()

    expect(FakeNotification.instances).toHaveLength(0)
  })

  it("reports a finished turn", async () => {
    const harness = createHarness()
    await apply(harness.ctx)
    harness.push({ s1: { running: true, completionUnread: false } })
    harness.push({ s1: { running: false, completionUnread: false } })
    await flush()

    expect(FakeNotification.instances).toHaveLength(1)
    expect(FakeNotification.instances[0]?.title).toBe("Turn finished")
    expect(FakeNotification.instances[0]?.options.body).toBe("Fix login")
  })

  it("keeps every notification closed on teardown", async () => {
    const harness = createHarness()
    await apply(harness.ctx)
    harness.push({ s1: { running: true, completionUnread: false, pendingInteraction: approval() } })
    await flush()

    harness.dispose()

    expect(FakeNotification.instances[0]?.closed).toBe(true)
  })

  it("registers the settings section under the notify id", async () => {
    const harness = createHarness()
    await apply(harness.ctx)

    expect(harness.registrations.some((entry) => entry.id === "notify")).toBe(true)
  })

  it("injects and removes the switch stylesheet", async () => {
    const harness = createHarness()
    await apply(harness.ctx)

    expect(styleTags).toHaveLength(1)
    expect(styleTags[0]?.dataset.plugin).toBe("@1outres/dsh-plugin-notify")
    expect(styleTags[0]?.textContent).toContain(".dsh-notify-switch")

    harness.dispose()

    expect(styleTags[0]?.removed).toBe(true)
  })

  it("uses the registration sink when a worker controls the page", async () => {
    const registration = fakeRegistration()
    const worker = fakeWorker(registration)
    page(false, false, { worker })
    const harness = createHarness()
    await apply(harness.ctx)
    harness.push({ s1: { running: true, completionUnread: false, pendingInteraction: approval() } })
    await flush()

    expect(registration.showNotification).toHaveBeenCalledWith("Approval needed", {
      body: "Fix login · bash: escalate sandbox",
      tag: "dsh-notify:approval:s1",
      data: {
        dshPwa: 1,
        openUrl: "./?dsh-notify-session=s1",
        payload: { sessionId: "s1" },
      },
      renotify: undefined,
    })
    expect(FakeNotification.instances).toHaveLength(0)
  })

  it("opens a Session from a worker click message", async () => {
    const worker = fakeWorker()
    page(false, false, { worker })
    const harness = createHarness()
    await apply(harness.ctx)

    worker.emit({ type: "dsh-pwa:notificationclick", payload: { sessionId: "s1" }, tag: "t" })

    expect(harness.opened).toEqual(["s1"])
    expect(window.focus).toHaveBeenCalled()
  })

  it("opens a Session from the URL and removes the parameter", async () => {
    const { replaceState } = page(false, false, {
      url: "https://dsh.example/?dsh-notify-session=s1&keep=1",
    })
    const harness = createHarness()
    await apply(harness.ctx)

    expect(harness.opened).toEqual(["s1"])
    expect(replaceState).toHaveBeenCalledTimes(1)
    const url = replaceState.mock.calls[0]?.[2] as URL
    expect(url.searchParams.has("dsh-notify-session")).toBe(false)
    expect(url.searchParams.get("keep")).toBe("1")
  })

  it("does not raise local notifications when push is on", async () => {
    const registration = fakeRegistration(fakeSubscription())
    const worker = fakeWorker(registration)
    page(false, false, { worker, pushManager: true })
    const harness = createHarness()
    await apply(harness.ctx)
    await vi.waitFor(() => expect(harness.pushRemote.subscribes).toHaveLength(1))

    harness.push({ s1: { running: true, completionUnread: false, pendingInteraction: approval() } })
    await flush()

    expect(FakeNotification.instances).toHaveLength(0)
    expect(registration.showNotification).not.toHaveBeenCalled()
  })
})
