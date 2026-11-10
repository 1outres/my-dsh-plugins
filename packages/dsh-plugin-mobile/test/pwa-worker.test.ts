import { afterEach, describe, expect, it, vi } from "vitest"
import { createPwaStore, detectPlatform } from "../src/client/pwa/state"
import {
  installPwaWorker,
  type ServiceWorkerContainerLike,
  STANDALONE_QUERY,
  type WorkerWindowLike,
} from "../src/client/pwa/worker"
import type { BooleanSetting } from "../src/client/types"

function media(matches: boolean) {
  const listeners = new Set<() => void>()
  return {
    matches,
    addEventListener: (_type: "change", listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: "change", listener: () => void) => listeners.delete(listener),
    change(next: boolean) {
      this.matches = next
      for (const listener of [...listeners]) listener()
    },
    listeners,
  }
}

function setting(value: boolean) {
  const listeners = new Set<() => void>()
  const source: BooleanSetting & { set(next: boolean): void; listeners: Set<() => void> } = {
    get: () => value,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(next: boolean) {
      value = next
      for (const listener of [...listeners]) listener()
    },
    listeners,
  }
  return source
}

interface Container extends ServiceWorkerContainerLike {
  registrations: { url: string; options: { scope: string } }[]
  unregistered: string[]
  activeScript: string | undefined
  fail: Error | undefined
}

function container(): Container {
  const state: Container = {
    registrations: [],
    unregistered: [],
    activeScript: "/dsh-mobile-sw.js",
    fail: undefined,
    register: async (url, options) => {
      state.registrations.push({ url, options })
      if (state.fail !== undefined) throw state.fail
      return { active: null, unregister: async () => true }
    },
    getRegistration: async () => {
      if (state.activeScript === undefined) return undefined
      const scriptURL = state.activeScript
      return {
        active: { scriptURL },
        unregister: async () => {
          state.unregistered.push(scriptURL)
          return true
        },
      }
    },
  }
  return state
}

function createWindow(options: {
  serviceWorker?: Container
  secure?: boolean
  standalone?: boolean
  userAgent?: string
  platform?: string
  maxTouchPoints?: number
}) {
  const display = media(false)
  const win: WorkerWindowLike = {
    isSecureContext: options.secure ?? true,
    navigator: {
      serviceWorker: options.serviceWorker,
      standalone: options.standalone ?? false,
      userAgent: options.userAgent ?? "Mozilla/5.0 (X11; Linux x86_64)",
      platform: options.platform ?? "Linux x86_64",
      maxTouchPoints: options.maxTouchPoints ?? 0,
    },
    matchMedia: (query: string) => {
      if (query !== STANDALONE_QUERY) throw new Error(`unexpected query: ${query}`)
      return display
    },
  }
  return { win, display }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  vi.restoreAllMocks()
})

describe("PWA state", () => {
  it("detects iOS and iPadOS from the user agent or a Mac with a touch screen", () => {
    expect(detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)", "iPhone", 5)).toBe("ios")
    expect(detectPlatform("Mozilla/5.0 (iPad; CPU OS 17_0)", "iPad", 5)).toBe("ios")
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 5)).toBe(
      "ios",
    )
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 0)).toBe(
      "other",
    )
    expect(detectPlatform("Mozilla/5.0 (Linux; Android 14)", "Linux armv8l", 5)).toBe("other")
  })

  it("keeps the snapshot while nothing changes", () => {
    const store = createPwaStore()
    const listener = vi.fn()
    store.subscribe(listener)
    const initial = store.getSnapshot()
    store.update({ worker: "registering" })
    expect(store.getSnapshot()).not.toBe(initial)
    expect(listener).toHaveBeenCalledTimes(1)
    store.update({ worker: "registering" })
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe("service worker registration", () => {
  it("reports a browser without service workers", () => {
    const source = setting(true)
    const { win } = createWindow({})
    const store = createPwaStore()
    const dispose = installPwaWorker(win, store, source)
    expect(store.getSnapshot().worker).toBe("unsupported")
    expect(store.getSnapshot().platform).toBe("other")
    dispose()
  })

  it("reports an insecure page instead of registering", () => {
    const source = setting(true)
    const worker = container()
    const { win } = createWindow({ serviceWorker: worker, secure: false })
    const store = createPwaStore()
    const dispose = installPwaWorker(win, store, source)
    expect(store.getSnapshot().worker).toBe("insecure")
    expect(worker.registrations).toEqual([])
    dispose()
  })

  it("registers the script at the site root scope", async () => {
    const source = setting(true)
    const worker = container()
    const { win } = createWindow({ serviceWorker: worker })
    const store = createPwaStore()
    const dispose = installPwaWorker(win, store, source)
    expect(store.getSnapshot().worker).toBe("registering")
    await flush()
    expect(worker.registrations).toEqual([{ url: "./dsh-mobile-sw.js", options: { scope: "./" } }])
    expect(store.getSnapshot().worker).toBe("ready")
    dispose()
  })

  it("stays off until the setting is on", async () => {
    const source = setting(false)
    const worker = container()
    const { win } = createWindow({ serviceWorker: worker })
    const store = createPwaStore()
    const dispose = installPwaWorker(win, store, source)
    expect(store.getSnapshot().worker).toBe("off")
    expect(worker.registrations).toEqual([])

    source.set(true)
    await flush()
    expect(worker.registrations).toHaveLength(1)
    expect(store.getSnapshot().worker).toBe("ready")
    expect(worker.registrations).toHaveLength(1)
    dispose()
  })

  it("unregisters an own registration when the setting turns off", async () => {
    const source = setting(true)
    const worker = container()
    const { win } = createWindow({ serviceWorker: worker })
    const store = createPwaStore()
    const dispose = installPwaWorker(win, store, source)
    await flush()

    source.set(false)
    await flush()
    expect(worker.unregistered).toEqual(["/dsh-mobile-sw.js"])
    expect(store.getSnapshot().worker).toBe("off")
    dispose()
  })

  it("keeps the registration when the setting turns back on while unregistering", async () => {
    const source = setting(true)
    const worker = container()
    const { win } = createWindow({ serviceWorker: worker })
    const store = createPwaStore()
    const dispose = installPwaWorker(win, store, source)
    await flush()

    source.set(false)
    source.set(true)
    await flush()
    expect(worker.unregistered).toEqual([])
    expect(worker.registrations).toHaveLength(2)
    expect(store.getSnapshot().worker).toBe("ready")
    dispose()
  })

  it("leaves another plugin's registration alone", async () => {
    const source = setting(true)
    const worker = container()
    worker.activeScript = "/other-sw.js"
    const { win } = createWindow({ serviceWorker: worker })
    const store = createPwaStore()
    const dispose = installPwaWorker(win, store, source)
    await flush()

    source.set(false)
    await flush()
    expect(worker.unregistered).toEqual([])
    expect(store.getSnapshot().worker).toBe("off")
    dispose()
  })

  it("keeps the registration on teardown", async () => {
    const source = setting(true)
    const worker = container()
    const { win, display } = createWindow({ serviceWorker: worker })
    const store = createPwaStore()
    const dispose = installPwaWorker(win, store, source)
    await flush()

    dispose()
    await flush()
    expect(worker.unregistered).toEqual([])
    expect(source.listeners.size).toBe(0)
    expect(display.listeners.size).toBe(0)
  })

  it("reports a failed registration without retrying on another setting change", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const source = setting(true)
    const worker = container()
    worker.fail = new Error("nope")
    const { win } = createWindow({ serviceWorker: worker })
    const store = createPwaStore()
    const dispose = installPwaWorker(win, store, source)
    await flush()
    expect(store.getSnapshot().worker).toBe("failed")
    expect(worker.registrations).toHaveLength(1)

    source.set(true)
    await flush()
    expect(worker.registrations).toHaveLength(1)
    dispose()
  })

  it("follows the standalone display mode and the iOS navigator flag", async () => {
    const source = setting(true)
    const { win, display } = createWindow({
      serviceWorker: container(),
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)",
      platform: "iPhone",
      maxTouchPoints: 5,
      standalone: true,
    })
    const store = createPwaStore()
    const dispose = installPwaWorker(win, store, source)
    expect(store.getSnapshot().standalone).toBe(true)
    expect(store.getSnapshot().platform).toBe("ios")

    display.change(true)
    expect(store.getSnapshot().standalone).toBe(true)
    dispose()
  })
})
