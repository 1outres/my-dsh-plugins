import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  type BrowserPushSubscription,
  type BrowserRegistration,
  createPushController,
  decodeBase64Url,
  describeBrowser,
  type HostPushRemote,
  type PushEnvironment,
} from "../src/client/push"

function bytes(length: number, first = 0): Uint8Array {
  const value = new Uint8Array(length)
  value[0] = first
  return value
}

class FakeSubscription implements BrowserPushSubscription {
  readonly options: { applicationServerKey?: ArrayBuffer | null }
  readonly p256dh: Uint8Array
  readonly auth: Uint8Array
  unsubscribed = false

  constructor(
    readonly endpoint: string,
    applicationServerKey: Uint8Array | null = null,
  ) {
    this.options = {
      applicationServerKey:
        applicationServerKey === null ? null : (applicationServerKey.buffer as ArrayBuffer),
    }
    this.p256dh = bytes(65, 4)
    this.auth = bytes(16, 1)
  }

  getKey(name: "p256dh" | "auth"): ArrayBuffer | null {
    return (name === "p256dh" ? this.p256dh : this.auth).buffer as ArrayBuffer
  }

  async unsubscribe(): Promise<boolean> {
    this.unsubscribed = true
    return true
  }
}

class FakePushManager {
  subscription: FakeSubscription | null = null
  readonly subscribes: { userVisibleOnly: true; applicationServerKey: Uint8Array }[] = []

  async getSubscription(): Promise<FakeSubscription | null> {
    return this.subscription
  }

  async subscribe(options: {
    userVisibleOnly: true
    applicationServerKey: Uint8Array
  }): Promise<FakeSubscription> {
    this.subscribes.push(options)
    this.subscription = new FakeSubscription(
      "https://push.example.com/new",
      options.applicationServerKey,
    )
    return this.subscription
  }
}

class FakeRegistration implements BrowserRegistration {
  readonly pushManager = new FakePushManager()
}

type Listener = () => void

class FakeEnvironment implements PushEnvironment {
  supported = true
  permissionValue: "granted" | "denied" | "default" | "unsupported" = "granted"
  permissionRequests = 0
  ios = false
  standalone = true
  userAgentValue = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"
  registrationValue: FakeRegistration | undefined = new FakeRegistration()
  page = { visible: true, focused: true }
  readonly listeners = new Map<string, Set<Listener>>()
  readonly intervals = new Map<number, Listener>()
  #nextHandle = 1

  pushSupported(): boolean {
    return this.supported
  }

  permission(): "granted" | "denied" | "default" | "unsupported" {
    return this.permissionValue
  }

  async requestPermission(): Promise<"granted" | "denied" | "default" | "unsupported"> {
    this.permissionRequests += 1
    this.permissionValue = "granted"
    return this.permissionValue
  }

  async registration(): Promise<FakeRegistration | undefined> {
    return this.registrationValue
  }

  isIos(): boolean {
    return this.ios
  }

  isStandalone(): boolean {
    return this.standalone
  }

  userAgent(): string {
    return this.userAgentValue
  }

  now(): number {
    return 1234
  }

  setInterval(callback: Listener, _ms: number): number {
    const handle = this.#nextHandle++
    this.intervals.set(handle, callback)
    return handle
  }

  clearInterval(handle: number): void {
    this.intervals.delete(handle)
  }

  listen(
    target: "visibilitychange" | "focus" | "blur" | "pagehide",
    callback: Listener,
  ): () => void {
    const listeners = this.listeners.get(target) ?? new Set()
    listeners.add(callback)
    this.listeners.set(target, listeners)
    return () => {
      listeners.delete(callback)
    }
  }

  pageState(): { visible: boolean; focused: boolean } {
    return this.page
  }

  fire(target: string): void {
    for (const listener of this.listeners.get(target) ?? []) listener()
  }

  tick(): void {
    for (const callback of this.intervals.values()) callback()
  }
}

class FakeRemote implements HostPushRemote {
  publicKeyValue = "AQID"
  readonly subscribes: { endpoint: string; p256dh: string; auth: string; label: string }[] = []
  readonly unsubscribes: string[] = []
  readonly presenceCalls: { endpoint: string; visible: boolean; focused: boolean }[] = []
  testResult: "sent" | "gone" | "failed" = "sent"
  subscribeOk = true

  async publicKey(): Promise<{ ok: true; value: { publicKey: string } }> {
    return { ok: true, value: { publicKey: this.publicKeyValue } }
  }

  async subscribe(input: {
    endpoint: string
    p256dh: string
    auth: string
    label: string
  }): Promise<{ ok: true; value: { id: string } } | { ok: false; error: { message: string } }> {
    this.subscribes.push(input)
    if (!this.subscribeOk) return { ok: false, error: { message: "refused" } }
    return { ok: true, value: { id: "id" } }
  }

  async unsubscribe(endpoint: string): Promise<{ ok: true; value: { removed: boolean } }> {
    this.unsubscribes.push(endpoint)
    return { ok: true, value: { removed: true } }
  }

  async presence(
    endpoint: string,
    visible: boolean,
    focused: boolean,
  ): Promise<{ ok: true; value: { ok: true } }> {
    this.presenceCalls.push({ endpoint, visible, focused })
    return { ok: true, value: { ok: true } }
  }

  async status(_endpoint: string): Promise<{ ok: true; value: { subscribed: boolean } }> {
    return { ok: true, value: { subscribed: true } }
  }

  async test(
    _endpoint: string,
  ): Promise<{ ok: true; value: { result: "sent" | "gone" | "failed" } }> {
    return { ok: true, value: { result: this.testResult } }
  }
}

function createHarness() {
  const environment = new FakeEnvironment()
  const remote = new FakeRemote()
  const controller = createPushController({ remote, environment })
  return { environment, remote, controller }
}

async function flush(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("createPushController", () => {
  it("reports unsupported browsers", async () => {
    const harness = createHarness()
    harness.environment.supported = false

    await harness.controller.refresh()

    expect(harness.controller.state.getSnapshot()).toBe("unsupported")
  })

  it("reports a denied permission", async () => {
    const harness = createHarness()
    harness.environment.permissionValue = "denied"

    await harness.controller.refresh()

    expect(harness.controller.state.getSnapshot()).toBe("denied")
  })

  it("reports a missing install on iOS", async () => {
    const harness = createHarness()
    harness.environment.ios = true
    harness.environment.standalone = false

    await harness.controller.refresh()

    expect(harness.controller.state.getSnapshot()).toBe("needs-install")
  })

  it("reports a missing install before unsupported on iOS", async () => {
    const harness = createHarness()
    harness.environment.supported = false
    harness.environment.ios = true
    harness.environment.standalone = false

    await harness.controller.refresh()

    expect(harness.controller.state.getSnapshot()).toBe("needs-install")
  })

  it("reports a missing install before unsupported when enabling on iOS", async () => {
    const harness = createHarness()
    harness.environment.supported = false
    harness.environment.ios = true
    harness.environment.standalone = false

    await harness.controller.enable()

    expect(harness.controller.state.getSnapshot()).toBe("needs-install")
    expect(harness.environment.permissionRequests).toBe(0)
  })

  it("reports a missing worker", async () => {
    const harness = createHarness()
    harness.environment.registrationValue = undefined

    await harness.controller.refresh()

    expect(harness.controller.state.getSnapshot()).toBe("no-worker")
  })

  it("reports off without a subscription", async () => {
    const harness = createHarness()

    await harness.controller.refresh()

    expect(harness.controller.state.getSnapshot()).toBe("off")
  })

  it("re-registers an existing subscription with the Host", async () => {
    const harness = createHarness()
    const registration = harness.environment.registrationValue
    if (registration === undefined) throw new Error("no registration")
    registration.pushManager.subscription = new FakeSubscription("https://push.example.com/old")

    await harness.controller.refresh()
    await flush()

    expect(harness.controller.state.getSnapshot()).toBe("on")
    expect(harness.remote.subscribes).toEqual([
      {
        endpoint: "https://push.example.com/old",
        p256dh: Buffer.from(bytes(65, 4)).toString("base64url"),
        auth: Buffer.from(bytes(16, 1)).toString("base64url"),
        label: "Safari on iPhone",
      },
    ])
  })

  it("enables push with the Host public key", async () => {
    const harness = createHarness()
    harness.environment.permissionValue = "default"

    await harness.controller.enable()

    expect(harness.environment.permissionRequests).toBe(1)
    const registration = harness.environment.registrationValue
    if (registration === undefined) throw new Error("no registration")
    expect(registration.pushManager.subscribes).toHaveLength(1)
    expect(Array.from(registration.pushManager.subscribes[0]?.applicationServerKey ?? [])).toEqual([
      1, 2, 3,
    ])
    expect(harness.controller.state.getSnapshot()).toBe("on")
  })

  it("replaces a subscription made with another application server key", async () => {
    const harness = createHarness()
    const registration = harness.environment.registrationValue
    if (registration === undefined) throw new Error("no registration")
    const old = new FakeSubscription("https://push.example.com/old", bytes(3, 9))
    registration.pushManager.subscription = old

    await harness.controller.enable()

    expect(old.unsubscribed).toBe(true)
    expect(registration.pushManager.subscribes).toHaveLength(1)
    expect(harness.remote.subscribes[0]?.endpoint).toBe("https://push.example.com/new")
  })

  it("keeps a subscription already made with the same key", async () => {
    const harness = createHarness()
    const registration = harness.environment.registrationValue
    if (registration === undefined) throw new Error("no registration")
    registration.pushManager.subscription = new FakeSubscription(
      "https://push.example.com/same",
      new Uint8Array([1, 2, 3]),
    )

    await harness.controller.enable()

    expect(registration.pushManager.subscribes).toHaveLength(0)
    expect(harness.remote.subscribes[0]?.endpoint).toBe("https://push.example.com/same")
  })

  it("disables push in the browser and on the Host", async () => {
    const harness = createHarness()
    const registration = harness.environment.registrationValue
    if (registration === undefined) throw new Error("no registration")
    registration.pushManager.subscription = new FakeSubscription("https://push.example.com/old")
    await harness.controller.refresh()
    await flush()

    await harness.controller.disable()

    expect(registration.pushManager.subscription?.unsubscribed).toBe(true)
    expect(harness.remote.unsubscribes).toEqual(["https://push.example.com/old"])
    expect(harness.controller.state.getSnapshot()).toBe("off")
  })

  it("sends a test push and turns off when the Host lost the subscription", async () => {
    const harness = createHarness()
    const registration = harness.environment.registrationValue
    if (registration === undefined) throw new Error("no registration")
    registration.pushManager.subscription = new FakeSubscription("https://push.example.com/old")
    await harness.controller.refresh()
    await flush()

    expect(await harness.controller.test()).toBe("sent")

    harness.remote.testResult = "gone"
    expect(await harness.controller.test()).toBe("gone")
    expect(harness.controller.state.getSnapshot()).toBe("off")
  })

  it("reports presence while subscribed", async () => {
    const harness = createHarness()
    const registration = harness.environment.registrationValue
    if (registration === undefined) throw new Error("no registration")
    registration.pushManager.subscription = new FakeSubscription("https://push.example.com/old")

    const stop = harness.controller.start()
    await flush()
    await flush()

    expect(harness.controller.state.getSnapshot()).toBe("on")

    harness.environment.page = { visible: false, focused: false }
    harness.environment.fire("visibilitychange")
    harness.environment.tick()
    await flush()

    expect(harness.remote.presenceCalls).toEqual([
      { endpoint: "https://push.example.com/old", visible: false, focused: false },
      { endpoint: "https://push.example.com/old", visible: false, focused: false },
    ])

    stop()
    harness.environment.tick()
    await flush()
    expect(harness.remote.presenceCalls).toHaveLength(2)
  })
})

describe("describeBrowser", () => {
  it("names the common browser and platform pairs", () => {
    expect(describeBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(
      "Safari on iPhone",
    )
    expect(describeBrowser("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe("Safari on iPad")
    expect(
      describeBrowser(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
      ),
    ).toBe("Chrome on Android")
    expect(
      describeBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605 Safari/605"),
    ).toBe("Safari on Mac")
    expect(describeBrowser("Mozilla/5.0 (Windows NT 10.0; Win64) Gecko/20100101 Firefox/120")).toBe(
      "Firefox on Windows",
    )
    expect(describeBrowser("something else")).toBe("Web browser")
  })
})

describe("decodeBase64Url", () => {
  it("decodes url-safe values with and without padding", () => {
    expect(Array.from(decodeBase64Url("AQID"))).toEqual([1, 2, 3])
    expect(Array.from(decodeBase64Url("-_8="))).toEqual([251, 255])
  })
})
