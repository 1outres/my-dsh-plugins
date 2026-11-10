import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createInstallPrompt,
  type InstallPromptEvent,
  type InstallWindowLike,
} from "../src/client/pwa/install"
import { createPwaStore } from "../src/client/pwa/state"

type Listener = (event: unknown) => void

function createWindow() {
  const listeners = new Map<string, Set<Listener>>()
  const win = {
    addEventListener: (type: string, listener: Listener) => {
      const set = listeners.get(type) ?? new Set()
      set.add(listener)
      listeners.set(type, set)
    },
    removeEventListener: (type: string, listener: Listener) => {
      listeners.get(type)?.delete(listener)
    },
  }
  const dispatch = (type: string, event?: unknown) => {
    for (const listener of [...(listeners.get(type) ?? [])]) listener(event)
  }
  return { win: win as unknown as InstallWindowLike, dispatch, listeners }
}

function promptEvent(outcome: "accepted" | "dismissed") {
  const prompt = vi.fn(async () => {})
  const event = {
    preventDefault: vi.fn(),
    prompt,
    userChoice: Promise.resolve({ outcome }),
  } satisfies InstallPromptEvent
  return { event, prompt }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("install prompt", () => {
  it("captures beforeinstallprompt and stops the browser's own banner", () => {
    const { win, dispatch } = createWindow()
    const store = createPwaStore()
    const install = createInstallPrompt(win, store)
    const stop = install.start()

    const { event } = promptEvent("accepted")
    dispatch("beforeinstallprompt", event)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().installable).toBe(true)
    stop()
  })

  it("reports unavailable when no prompt was captured", async () => {
    const { win } = createWindow()
    const store = createPwaStore()
    const install = createInstallPrompt(win, store)
    const stop = install.start()
    expect(await install.install()).toBe("unavailable")
    stop()
  })

  it("runs the captured prompt once and returns the user's choice", async () => {
    const { win, dispatch } = createWindow()
    const store = createPwaStore()
    const install = createInstallPrompt(win, store)
    const stop = install.start()

    const { event, prompt } = promptEvent("accepted")
    dispatch("beforeinstallprompt", event)
    expect(await install.install()).toBe("accepted")
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().installable).toBe(false)
    expect(await install.install()).toBe("unavailable")
    stop()
  })

  it("passes a dismissed choice through", async () => {
    const { win, dispatch } = createWindow()
    const store = createPwaStore()
    const install = createInstallPrompt(win, store)
    const stop = install.start()
    dispatch("beforeinstallprompt", promptEvent("dismissed").event)
    expect(await install.install()).toBe("dismissed")
    stop()
  })

  it("clears the prompt when the app was installed", async () => {
    const { win, dispatch } = createWindow()
    const store = createPwaStore()
    const install = createInstallPrompt(win, store)
    const stop = install.start()
    dispatch("beforeinstallprompt", promptEvent("accepted").event)
    dispatch("appinstalled")
    expect(store.getSnapshot().installable).toBe(false)
    expect(await install.install()).toBe("unavailable")
    stop()
  })

  it("removes its listeners on teardown", () => {
    const { win, listeners } = createWindow()
    const store = createPwaStore()
    const install = createInstallPrompt(win, store)
    const stop = install.start()
    expect(listeners.get("beforeinstallprompt")?.size).toBe(1)
    expect(listeners.get("appinstalled")?.size).toBe(1)

    stop()
    expect(listeners.get("beforeinstallprompt")?.size).toBe(0)
    expect(listeners.get("appinstalled")?.size).toBe(0)
    expect(store.getSnapshot().installable).toBe(false)
  })
})
