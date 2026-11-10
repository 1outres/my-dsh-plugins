import { createHash } from "node:crypto"
import type { PwaPushMessage } from "../../shared/protocol"
import { encrypt } from "./crypto"
import { type VapidKeys, vapidAuthorization } from "./vapid"

/** One stored subscription. */
export interface PushSubscription {
  readonly endpoint: string
  /** The user agent public key, base64url. */
  readonly p256dh: string
  /** The authentication secret, base64url. */
  readonly auth: string
  readonly label: string
  readonly createdAt: number
}

export interface PushSendOptions {
  readonly ttlSeconds: number
  readonly urgency: "high" | "normal"
  readonly topic?: string
}

export type PushSendResult =
  | "sent"
  | "gone"
  | { readonly failed: { readonly status: number; readonly message: string } }

export interface PushSender {
  send(
    subscription: PushSubscription,
    message: PwaPushMessage,
    options: PushSendOptions,
  ): Promise<PushSendResult>
}

export interface PushFetchResponse {
  readonly status: number
}

export type FetchLike = (
  input: string,
  init: {
    readonly method: string
    readonly headers: Record<string, string>
    readonly body: Uint8Array
  },
) => Promise<PushFetchResponse>

export interface PushSenderOptions {
  readonly fetch: FetchLike
  readonly vapid: () => Promise<VapidKeys>
  readonly subject: () => string
}

/** Send encrypted Web Push messages with the Host's VAPID identity. */
export function createPushSender(options: PushSenderOptions): PushSender {
  return {
    async send(subscription, message, settings) {
      const keys = await options.vapid()
      const body = encrypt({
        plaintext: new TextEncoder().encode(JSON.stringify(message)),
        uaPublic: new Uint8Array(Buffer.from(subscription.p256dh, "base64url")),
        authSecret: new Uint8Array(Buffer.from(subscription.auth, "base64url")),
      })
      const headers: Record<string, string> = {
        Authorization: vapidAuthorization(subscription.endpoint, keys, {
          subject: options.subject(),
        }),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(settings.ttlSeconds),
        Urgency: settings.urgency,
      }
      if (settings.topic !== undefined) headers.Topic = settings.topic

      let response: PushFetchResponse
      try {
        response = await options.fetch(subscription.endpoint, {
          method: "POST",
          headers,
          body,
        })
      } catch (error) {
        return { failed: { status: 0, message: messageOf(error) } }
      }
      if (response.status >= 200 && response.status < 300) return "sent"
      if (response.status === 404 || response.status === 410) return "gone"
      return {
        failed: {
          status: response.status,
          message: `The push service answered ${response.status}`,
        },
      }
    },
  }
}

/**
 * Derive the `Topic` header from a notification tag. Push services replace a
 * queued message with the same topic and accept at most 32 url-safe chars.
 */
export function topicOf(tag: string): string {
  return createHash("sha256").update(tag).digest("base64url").slice(0, 32)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
