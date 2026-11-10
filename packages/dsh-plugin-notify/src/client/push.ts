import type { Observable } from "./types"

/** What this browser can do about Web Push right now. */
export type PushState =
  | "unsupported"
  | "no-worker"
  | "needs-install"
  | "off"
  | "on"
  | "denied"
  | "error"

export type PushTestResult = "sent" | "gone" | "failed"

export type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly message?: string } }

export interface PushSubscriptionInput {
  readonly endpoint: string
  readonly p256dh: string
  readonly auth: string
  readonly label: string
}

/** The Remote methods the browser half calls. */
export interface HostPushRemote {
  publicKey(): Promise<RemoteResult<{ publicKey: string }>>
  subscribe(input: PushSubscriptionInput): Promise<RemoteResult<{ id: string }>>
  unsubscribe(endpoint: string): Promise<RemoteResult<{ removed: boolean }>>
  presence(
    endpoint: string,
    visible: boolean,
    focused: boolean,
  ): Promise<RemoteResult<{ ok: true }>>
  status(endpoint: string): Promise<RemoteResult<{ subscribed: boolean }>>
  test(endpoint: string): Promise<RemoteResult<{ result: PushTestResult }>>
}

export interface BrowserPushSubscription {
  readonly endpoint: string
  readonly options: { readonly applicationServerKey?: ArrayBuffer | null }
  getKey(name: "p256dh" | "auth"): ArrayBuffer | null
  unsubscribe(): Promise<boolean>
}

export interface BrowserPushManager {
  getSubscription(): Promise<BrowserPushSubscription | null>
  subscribe(options: {
    readonly userVisibleOnly: true
    readonly applicationServerKey: Uint8Array
  }): Promise<BrowserPushSubscription>
}

export interface BrowserRegistration {
  readonly pushManager: BrowserPushManager
}

/** Browser capabilities, kept behind an interface so tests can fake them. */
export interface PushEnvironment {
  pushSupported(): boolean
  permission(): "granted" | "denied" | "default" | "unsupported"
  requestPermission(): Promise<"granted" | "denied" | "default" | "unsupported">
  registration(): Promise<BrowserRegistration | undefined>
  isIos(): boolean
  isStandalone(): boolean
  userAgent(): string
  now(): number
  setInterval(callback: () => void, ms: number): number
  clearInterval(handle: number): void
  listen(
    target: "visibilitychange" | "focus" | "blur" | "pagehide",
    callback: () => void,
  ): () => void
  pageState(): { readonly visible: boolean; readonly focused: boolean }
}

export interface PushControllerDeps {
  readonly remote: HostPushRemote
  readonly environment: PushEnvironment
  readonly onError?: (error: unknown) => void
}

export interface PushController {
  readonly state: Observable<PushState>
  /** Start watching presence and heal the Host subscription. Returns a disposer. */
  start(): () => void
  /** Re-read browser state and re-register an existing subscription. */
  refresh(): Promise<void>
  enable(): Promise<void>
  disable(): Promise<void>
  test(): Promise<PushTestResult>
}

const PRESENCE_INTERVAL_MS = 30_000
const PUSH_KEY_NAME = "p256dh"
const AUTH_KEY_NAME = "auth"

/** Browser push controller: one subscription per origin, healed on start. */
export function createPushController(deps: PushControllerDeps): PushController {
  return new BrowserPushController(deps)
}

class BrowserPushController implements PushController {
  readonly #remote: HostPushRemote
  readonly #environment: PushEnvironment
  readonly #onError: ((error: unknown) => void) | undefined
  readonly #listeners = new Set<() => void>()
  readonly state: Observable<PushState>
  #value: PushState = "off"
  #endpoint: string | undefined
  #started = false
  #stopWatch: (() => void) | undefined

  constructor(deps: PushControllerDeps) {
    this.#remote = deps.remote
    this.#environment = deps.environment
    this.#onError = deps.onError
    this.state = {
      getSnapshot: () => this.#value,
      subscribe: (listener) => {
        this.#listeners.add(listener)
        return () => {
          this.#listeners.delete(listener)
        }
      },
    }
  }

  start(): () => void {
    if (this.#started) return () => this.#stop()
    this.#started = true
    void this.refresh().catch((error) => this.#fail(error))
    return () => this.#stop()
  }

  async refresh(): Promise<void> {
    if (!this.#environment.pushSupported()) {
      this.#set("unsupported")
      return
    }
    const permission = this.#environment.permission()
    if (permission === "denied") {
      this.#set("denied")
      return
    }
    if (this.#needsInstall()) {
      this.#set("needs-install")
      return
    }
    try {
      const registration = await this.#environment.registration()
      if (registration === undefined) {
        this.#set("no-worker")
        return
      }
      const subscription = await registration.pushManager.getSubscription()
      if (subscription === null) {
        this.#endpoint = undefined
        this.#set("off")
        return
      }
      this.#endpoint = subscription.endpoint
      if (permission !== "granted") {
        this.#set("off")
        return
      }
      if (!(await this.#register(subscription))) return
      this.#set("on")
    } catch (error) {
      this.#fail(error)
    }
  }

  async enable(): Promise<void> {
    if (!this.#environment.pushSupported()) {
      this.#set("unsupported")
      return
    }
    if (this.#needsInstall()) {
      this.#set("needs-install")
      return
    }
    try {
      let permission = this.#environment.permission()
      if (permission === "default") permission = await this.#environment.requestPermission()
      if (permission === "denied") {
        this.#set("denied")
        return
      }
      if (permission !== "granted") {
        this.#set("off")
        return
      }
      const registration = await this.#environment.registration()
      if (registration === undefined) {
        this.#set("no-worker")
        return
      }
      const keys = await this.#remote.publicKey()
      if (!keys.ok) {
        this.#set("error")
        return
      }
      const applicationServerKey = decodeBase64Url(keys.value.publicKey)
      const existing = await registration.pushManager.getSubscription()
      if (
        existing !== null &&
        !sameKey(existing.options.applicationServerKey, applicationServerKey)
      ) {
        await existing.unsubscribe()
      }
      const subscription =
        existing !== null && sameKey(existing.options.applicationServerKey, applicationServerKey)
          ? existing
          : await registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey,
            })
      if (!(await this.#register(subscription))) return
      this.#endpoint = subscription.endpoint
      this.#set("on")
    } catch (error) {
      this.#fail(error)
    }
  }

  async disable(): Promise<void> {
    try {
      const registration = await this.#environment.registration()
      if (registration !== undefined) {
        const subscription = await registration.pushManager.getSubscription()
        if (subscription !== null) {
          await subscription.unsubscribe()
          const result = await this.#remote.unsubscribe(subscription.endpoint)
          if (!result.ok) this.#onError?.(new Error(result.error.message ?? "refused"))
        }
      }
      this.#endpoint = undefined
      this.#set("off")
    } catch (error) {
      this.#fail(error)
    }
  }

  async test(): Promise<PushTestResult> {
    try {
      const registration = await this.#environment.registration()
      if (registration === undefined) {
        this.#set("no-worker")
        return "failed"
      }
      const subscription = await registration.pushManager.getSubscription()
      if (subscription === null) {
        this.#endpoint = undefined
        this.#set("off")
        return "failed"
      }
      const result = await this.#remote.test(subscription.endpoint)
      if (!result.ok) {
        this.#set("error")
        return "failed"
      }
      if (result.value.result === "gone") this.#set("off")
      return result.value.result
    } catch (error) {
      this.#fail(error)
      return "failed"
    }
  }

  async #register(subscription: BrowserPushSubscription): Promise<boolean> {
    const input: PushSubscriptionInput = {
      endpoint: subscription.endpoint,
      p256dh: encodeKey(subscription, PUSH_KEY_NAME),
      auth: encodeKey(subscription, AUTH_KEY_NAME),
      label: describeBrowser(this.#environment.userAgent()),
    }
    const result = await this.#remote.subscribe(input)
    if (!result.ok) {
      this.#set("error")
      return false
    }
    return true
  }

  #needsInstall(): boolean {
    return this.#environment.isIos() && !this.#environment.isStandalone()
  }

  #set(value: PushState): void {
    if (this.#value === value) {
      this.#syncPresenceWatch()
      return
    }
    this.#value = value
    this.#syncPresenceWatch()
    for (const listener of [...this.#listeners]) listener()
  }

  #syncPresenceWatch(): void {
    if (this.#started && this.#value === "on" && this.#endpoint !== undefined) {
      if (this.#stopWatch !== undefined) return
      const report = () => this.#reportPresence()
      const stops = [
        this.#environment.listen("visibilitychange", report),
        this.#environment.listen("focus", report),
        this.#environment.listen("blur", report),
        this.#environment.listen("pagehide", report),
      ]
      const interval = this.#environment.setInterval(report, PRESENCE_INTERVAL_MS)
      this.#stopWatch = () => {
        for (const stop of stops) stop()
        this.#environment.clearInterval(interval)
      }
      return
    }
    this.#stopWatch?.()
    this.#stopWatch = undefined
  }

  #reportPresence(): void {
    const endpoint = this.#endpoint
    if (endpoint === undefined) return
    const state = this.#environment.pageState()
    void this.#remote.presence(endpoint, state.visible, state.focused).then(
      (result) => {
        if (!result.ok) this.#onError?.(new Error(result.error.message ?? "presence refused"))
      },
      (error: unknown) => this.#onError?.(error),
    )
  }

  #stop(): void {
    this.#started = false
    this.#stopWatch?.()
    this.#stopWatch = undefined
  }

  #fail(error: unknown): void {
    this.#set("error")
    this.#onError?.(error)
  }
}

function encodeKey(subscription: BrowserPushSubscription, name: "p256dh" | "auth"): string {
  const key = subscription.getKey(name)
  if (key === null) throw new Error("The browser returned an incomplete subscription")
  return encodeBase64Url(new Uint8Array(key))
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = ""
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** Decode a base64url value, with or without padding. */
export function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function sameKey(existing: ArrayBuffer | null | undefined, key: Uint8Array): boolean {
  if (existing === null || existing === undefined) return false
  const bytes = new Uint8Array(existing)
  return bytes.length === key.length && bytes.every((byte, index) => byte === key[index])
}

/** A short device label for the Settings page and the Host record. */
export function describeBrowser(userAgent: string): string {
  if (/iPhone/.test(userAgent)) return "Safari on iPhone"
  if (/iPad/.test(userAgent)) return "Safari on iPad"
  if (/Android/.test(userAgent)) {
    if (/Firefox\//.test(userAgent)) return "Firefox on Android"
    if (/Chrome\//.test(userAgent)) return "Chrome on Android"
    return "Browser on Android"
  }
  if (/Macintosh/.test(userAgent)) {
    if (/Firefox\//.test(userAgent)) return "Firefox on Mac"
    if (/Edg\//.test(userAgent)) return "Edge on Mac"
    if (/Chrome\//.test(userAgent)) return "Chrome on Mac"
    return "Safari on Mac"
  }
  if (/Windows/.test(userAgent)) {
    if (/Firefox\//.test(userAgent)) return "Firefox on Windows"
    if (/Edg\//.test(userAgent)) return "Edge on Windows"
    if (/Chrome\//.test(userAgent)) return "Chrome on Windows"
    return "Browser on Windows"
  }
  if (/Linux/.test(userAgent)) {
    if (/Firefox\//.test(userAgent)) return "Firefox on Linux"
    if (/Chrome\//.test(userAgent)) return "Chrome on Linux"
    return "Browser on Linux"
  }
  return "Web browser"
}

/** The real browser implementation of {@link PushEnvironment}. */
export function createBrowserPushEnvironment(): PushEnvironment {
  return {
    pushSupported: () => typeof Notification !== "undefined" && typeof PushManager !== "undefined",
    permission: () =>
      typeof Notification === "undefined" ? "unsupported" : Notification.permission,
    requestPermission: async () => {
      if (typeof Notification === "undefined") return "unsupported"
      return Notification.requestPermission()
    },
    registration: async () => {
      const worker = (navigator as Navigator & { serviceWorker?: ServiceWorkerContainer })
        .serviceWorker
      if (worker === undefined || worker.controller === null) return undefined
      return (await worker.ready) as unknown as BrowserRegistration
    },
    isIos: () =>
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
    isStandalone: () =>
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    userAgent: () => navigator.userAgent,
    now: () => Date.now(),
    setInterval: (callback, ms) => window.setInterval(callback, ms),
    clearInterval: (handle) => window.clearInterval(handle),
    listen: (target, callback) => {
      window.addEventListener(target, callback)
      return () => window.removeEventListener(target, callback)
    },
    pageState: () => ({
      visible: document.visibilityState === "visible",
      focused: document.hasFocus(),
    }),
  }
}
