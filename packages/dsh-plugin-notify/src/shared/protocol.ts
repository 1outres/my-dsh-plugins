/**
 * DSH PWA worker protocol v1. The mobile plugin declares the same shapes; the
 * two packages agree on these names and shapes only, not on code.
 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

/** Message the worker posts to a page when the user clicks a notification. */
export const PWA_CLICK_MESSAGE = "dsh-pwa:notificationclick"

/** Query parameter that opens one Session on page load. */
export const OPEN_SESSION_PARAM = "dsh-notify-session"

/** The `data` option of every notification shown through the registration. */
export interface PwaNotificationData {
  readonly dshPwa: 1
  /** URL to open, relative to the registration scope, when no window is open. */
  readonly openUrl?: string
  /** Opaque JSON owned by the plugin that showed the notification. */
  readonly payload?: JsonValue
}

/** The JSON body of one Web Push message. */
export interface PwaPushMessage {
  readonly dshPwa: 1
  readonly title: string
  readonly options: {
    readonly body?: string
    readonly tag?: string
    readonly renotify?: boolean
    readonly requireInteraction?: boolean
    readonly silent?: boolean
    readonly data?: PwaNotificationData
  }
}
