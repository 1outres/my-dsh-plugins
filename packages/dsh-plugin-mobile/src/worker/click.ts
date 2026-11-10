import {
  type JsonValue,
  PWA_CLICK_MESSAGE,
  type PwaClickMessage,
  type PwaNotificationData,
} from "./protocol"

/** The slice of `WindowClient` the worker uses. */
export interface WindowClientLike {
  readonly url: string
  readonly focused: boolean
  readonly visibilityState?: string
  focus(): Promise<unknown>
  postMessage(message: unknown): void
}

/** Whether a window URL belongs to the registration scope. */
export function isInScope(url: string, scope: string): boolean {
  const base = new URL(scope)
  const prefix = base.pathname.endsWith("/") ? base.href : `${base.href}/`
  return new URL(url).href.startsWith(prefix)
}

/**
 * Pick the window to focus for a notification click: a focused one first, then
 * a visible one, then any other window of the app.
 */
export function pickWindowClient(
  clients: readonly WindowClientLike[],
  scope: string,
): WindowClientLike | null {
  const inside = clients.filter((client) => isInScope(client.url, scope))
  const focused = inside.find((client) => client.focused)
  if (focused !== undefined) return focused
  const visible = inside.find((client) => client.visibilityState === "visible")
  if (visible !== undefined) return visible
  return inside[0] ?? null
}

/** The message that tells an open window which notification was clicked. */
export function clickMessage(
  data: PwaNotificationData | null,
  tag: string | undefined,
): PwaClickMessage {
  const message: {
    type: typeof PWA_CLICK_MESSAGE
    payload?: JsonValue
    tag?: string
  } = { type: PWA_CLICK_MESSAGE }
  if (data !== null && data.payload !== undefined) message.payload = data.payload
  if (tag !== undefined) message.tag = tag
  return message
}

/** The URL to open when no window of the app is open. */
export function openUrl(data: PwaNotificationData | null, scope: string): string {
  return new URL(data?.openUrl ?? "./", scope).href
}
