import { afterEach, describe, expect, it, vi } from "vitest"
import type { WindowClientLike } from "../src/worker/click"
import { PWA_CLICK_MESSAGE } from "../src/worker/protocol"

type Listener = (event: unknown) => void

interface Shown {
  title: string
  options: NotificationOptions | undefined
}

interface FakeWorker {
  listeners: Map<string, Listener>
  shown: Shown[]
  opened: string[]
  messages: { url: string; message: unknown }[]
  calls: { skipped: number; claimed: number }
  scope: string
  language: string
}

function createWorker(clients: WindowClientLike[] = []): FakeWorker {
  const worker: FakeWorker = {
    listeners: new Map(),
    shown: [],
    opened: [],
    messages: [],
    calls: { skipped: 0, claimed: 0 },
    scope: "https://example.test/",
    language: "ja-JP",
  }
  vi.stubGlobal("self", {
    registration: {
      scope: worker.scope,
      showNotification: async (title: string, options?: NotificationOptions) => {
        worker.shown.push({ title, options })
      },
    },
    clients: {
      matchAll: async () => clients,
      openWindow: async (url: string) => {
        worker.opened.push(url)
      },
      claim: async () => {
        worker.calls.claimed += 1
      },
    },
    navigator: { language: worker.language },
    skipWaiting: async () => {
      worker.calls.skipped += 1
    },
    addEventListener: (type: string, listener: Listener) => {
      worker.listeners.set(type, listener)
    },
  })
  return worker
}

async function loadWorker(clients: WindowClientLike[] = []): Promise<FakeWorker> {
  vi.resetModules()
  const worker = createWorker(clients)
  await import("../src/worker/sw")
  return worker
}

function listener(worker: FakeWorker, type: string): Listener {
  const found = worker.listeners.get(type)
  if (found === undefined) throw new Error(`no ${type} listener`)
  return found
}

function extendable() {
  const pending: Promise<unknown>[] = []
  return {
    pending,
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise)
    },
  }
}

const raw = {
  dshPwa: 1,
  title: "Job done",
  options: {
    body: "The turn finished.",
    tag: "done:1",
    data: { dshPwa: 1, openUrl: "./?dsh-notify-session=s1", payload: { sessionId: "s1" } },
  },
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("service worker wiring", () => {
  it("takes over on install and activate", async () => {
    const worker = await loadWorker()
    const install = extendable()
    listener(worker, "install")(install)
    await Promise.all(install.pending)
    const activate = extendable()
    listener(worker, "activate")(activate)
    await Promise.all(activate.pending)
    expect(worker.calls).toEqual({ skipped: 1, claimed: 1 })
  })

  it("shows a push message through the registration", async () => {
    const worker = await loadWorker()
    const event = extendable()
    listener(worker, "push")({ data: { json: () => raw }, waitUntil: event.waitUntil })
    await Promise.all(event.pending)
    expect(worker.shown).toHaveLength(1)
    expect(worker.shown[0].title).toBe("Job done")
    expect(worker.shown[0].options).toMatchObject({
      body: "The turn finished.",
      tag: "done:1",
      icon: "https://example.test/icon-192.png",
      badge: "https://example.test/icon-192.png",
    })
  })

  it("shows a generic notification when the push body is not protocol v1", async () => {
    const worker = await loadWorker()
    const event = extendable()
    listener(
      worker,
      "push",
    )({
      data: {
        json: () => {
          throw new SyntaxError("not JSON")
        },
      },
      waitUntil: event.waitUntil,
    })
    await Promise.all(event.pending)
    expect(worker.shown).toHaveLength(1)
    expect(worker.shown[0].title).toBe("DeepSeek Harness")
    expect(worker.shown[0].options?.body).toBeUndefined()
  })

  it("focuses a client inside the scope and posts the click message", async () => {
    const focused: string[] = []
    const client: WindowClientLike = {
      url: "https://example.test/session/s1",
      focused: true,
      visibilityState: "visible",
      focus: async () => {
        focused.push("focus")
      },
      postMessage: (message) => {
        messages.push(message)
      },
    }
    const messages: unknown[] = []
    const worker = await loadWorker([client])
    const event = extendable()
    const closed: string[] = []
    listener(
      worker,
      "notificationclick",
    )({
      notification: {
        tag: "done:1",
        data: raw.options.data,
        close: () => closed.push("close"),
      },
      waitUntil: event.waitUntil,
    })
    await Promise.all(event.pending)
    expect(closed).toEqual(["close"])
    expect(focused).toEqual(["focus"])
    expect(messages).toEqual([
      {
        type: PWA_CLICK_MESSAGE,
        payload: { sessionId: "s1" },
        tag: "done:1",
      },
    ])
    expect(worker.opened).toEqual([])
  })

  it("opens the openUrl when no window of the app is open", async () => {
    const worker = await loadWorker()
    const event = extendable()
    listener(
      worker,
      "notificationclick",
    )({
      notification: { tag: "done:1", data: raw.options.data, close: () => {} },
      waitUntil: event.waitUntil,
    })
    await Promise.all(event.pending)
    expect(worker.opened).toEqual(["https://example.test/?dsh-notify-session=s1"])
  })

  it("answers a navigation with the network and falls back to the offline page", async () => {
    const worker = await loadWorker()
    const network = new Response("app", { status: 200 })
    vi.stubGlobal("fetch", async () => network)
    const served: Promise<Response>[] = []
    listener(
      worker,
      "fetch",
    )({
      request: { mode: "navigate" },
      respondWith: (response: Promise<Response>) => served.push(response),
    })
    expect(await served[0]).toBe(network)

    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch")
    })
    const offline: Promise<Response>[] = []
    listener(
      worker,
      "fetch",
    )({
      request: { mode: "navigate" },
      respondWith: (response: Promise<Response>) => offline.push(response),
    })
    const response = await offline[0]
    expect(response.status).toBe(503)
    expect(await response.text()).toContain("再試行")
  })

  it("leaves every other request to the browser", async () => {
    const worker = await loadWorker()
    const served: Promise<Response>[] = []
    listener(
      worker,
      "fetch",
    )({
      request: { mode: "cors" },
      respondWith: (response: Promise<Response>) => served.push(response),
    })
    expect(served).toEqual([])
  })
})
