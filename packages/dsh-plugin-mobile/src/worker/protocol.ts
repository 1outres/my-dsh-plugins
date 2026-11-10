/**
 * The DSH PWA worker protocol, version 1. The browser half of the notify
 * plugin declares its own copy of these shapes; keep the constant names and
 * the shapes identical in both packages.
 */

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

/** The only protocol version both packages speak. */
export const PWA_PROTOCOL_VERSION = 1
/** Path the Host serves the worker script from. */
export const WORKER_SCRIPT_PATH = "/dsh-mobile-sw.js"
/** Relative URL the page registers the worker with. */
export const WORKER_SCRIPT_URL = "./dsh-mobile-sw.js"
/** Registration scope: the site root, so one worker can control every page. */
export const WORKER_SCOPE = "./"
/** Message the worker posts to an open window when a notification is clicked. */
export const PWA_CLICK_MESSAGE = "dsh-pwa:notificationclick"

/** The `data` of every notification shown through the registration. */
export interface PwaNotificationData {
  readonly dshPwa: 1
  /** URL to open, relative to the registration scope, when no window is open. */
  readonly openUrl?: string
  /** Opaque JSON owned by the plugin that showed the notification. */
  readonly payload?: JsonValue
}

/** Notification options the protocol allows a push to set. */
export interface PwaPushOptions {
  readonly body?: string
  readonly tag?: string
  readonly renotify?: boolean
  readonly requireInteraction?: boolean
  readonly silent?: boolean
  readonly data?: PwaNotificationData
}

/** The JSON body of a Web Push message, UTF-8. */
export interface PwaPushMessage {
  readonly dshPwa: 1
  readonly title: string
  readonly options: PwaPushOptions
}

/** The message the worker posts to a window when a notification is clicked. */
export interface PwaClickMessage {
  readonly type: typeof PWA_CLICK_MESSAGE
  readonly payload?: JsonValue
  readonly tag?: string
}

/** Whether a value is a plain object with string keys. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Read the `data` of a notification.
 * @returns the normalized data, or null when it is not protocol v1.
 */
export function parseNotificationData(value: unknown): PwaNotificationData | null {
  if (!isRecord(value) || value.dshPwa !== PWA_PROTOCOL_VERSION) return null
  if (value.openUrl !== undefined && typeof value.openUrl !== "string") return null
  const data: { dshPwa: 1; openUrl?: string; payload?: JsonValue } = { dshPwa: 1 }
  if (typeof value.openUrl === "string") data.openUrl = value.openUrl
  if (value.payload !== undefined) data.payload = value.payload as JsonValue
  return data
}

/**
 * Read a push message body. Only the option keys of the protocol are kept, so
 * a sender cannot set something the contract does not allow.
 * @returns the normalized message, or null when it is not protocol v1.
 */
export function parsePushMessage(value: unknown): PwaPushMessage | null {
  if (!isRecord(value)) return null
  if (value.dshPwa !== PWA_PROTOCOL_VERSION) return null
  if (typeof value.title !== "string") return null
  const source = value.options
  if (!isRecord(source)) return null

  const options: {
    body?: string
    tag?: string
    renotify?: boolean
    requireInteraction?: boolean
    silent?: boolean
    data?: PwaNotificationData
  } = {}

  if (source.body !== undefined) {
    if (typeof source.body !== "string") return null
    options.body = source.body
  }
  if (source.tag !== undefined) {
    if (typeof source.tag !== "string") return null
    options.tag = source.tag
  }
  if (source.renotify !== undefined) {
    if (typeof source.renotify !== "boolean") return null
    options.renotify = source.renotify
  }
  if (source.requireInteraction !== undefined) {
    if (typeof source.requireInteraction !== "boolean") return null
    options.requireInteraction = source.requireInteraction
  }
  if (source.silent !== undefined) {
    if (typeof source.silent !== "boolean") return null
    options.silent = source.silent
  }
  if (source.data !== undefined) {
    const data = parseNotificationData(source.data)
    if (data === null) return null
    options.data = data
  }

  return { dshPwa: PWA_PROTOCOL_VERSION, title: value.title, options }
}
