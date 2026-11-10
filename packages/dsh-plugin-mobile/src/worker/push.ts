import { type PwaPushMessage, parsePushMessage } from "./protocol"

/** Title of the notification shown when a push is not protocol v1. */
export const DEFAULT_NOTIFICATION_TITLE = "DeepSeek Harness"
/** Icon and badge, relative to the registration scope. */
export const NOTIFICATION_ICON = "icon-192.png"

/** The part of `PushMessageData` the worker reads. */
export interface PushDataReader {
  json(): unknown
}

/**
 * Read a push event body.
 * @returns the message, or null when the body is missing, not JSON, or not
 * protocol v1.
 */
export function readPushMessage(data: PushDataReader | null | undefined): PwaPushMessage | null {
  if (data === null || data === undefined) return null
  try {
    return parsePushMessage(data.json())
  } catch {
    return null
  }
}

/** Title and options for `showNotification`. */
export interface NotificationSpec {
  readonly title: string
  readonly options: NotificationOptions
}

/**
 * Build the notification for a push. A push that is not protocol v1 still
 * shows a generic notification: Safari and Chrome penalize a push that shows
 * nothing at all, so the platform needs one.
 */
export function buildNotification(push: PwaPushMessage | null, scope: string): NotificationSpec {
  const icon = new URL(NOTIFICATION_ICON, scope).href
  if (push === null) {
    return { title: DEFAULT_NOTIFICATION_TITLE, options: { icon, badge: icon } }
  }
  return { title: push.title, options: { ...push.options, icon, badge: icon } }
}
