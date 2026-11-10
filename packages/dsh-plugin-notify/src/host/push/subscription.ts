/** A subscription a browser sends when it turns push on. */
export interface SubscriptionInput {
  readonly endpoint: string
  readonly p256dh: string
  readonly auth: string
  readonly label: string
}

const BASE64URL = /^[A-Za-z0-9_-]+$/
const PUBLIC_KEY_BYTES = 65
const AUTH_SECRET_BYTES = 16

/**
 * Reject a subscription that cannot receive a Web Push message. The endpoint
 * must be HTTPS, the user agent key a 65-byte uncompressed P-256 point, and
 * the authentication secret exactly 16 bytes (RFC 8291).
 */
export function validateSubscription(input: SubscriptionInput): void {
  if (typeof input !== "object" || input === null) {
    throw new Error("subscription must be an object")
  }
  if (typeof input.endpoint !== "string") {
    throw new Error("The push endpoint must be an https URL")
  }
  try {
    const url = new URL(input.endpoint)
    if (url.protocol !== "https:") throw new Error("not https")
  } catch {
    throw new Error("The push endpoint must be an https URL")
  }
  const p256dh = decode(input.p256dh, "p256dh")
  if (p256dh.length !== PUBLIC_KEY_BYTES || p256dh[0] !== 0x04) {
    throw new Error("p256dh must be a 65-byte uncompressed P-256 point")
  }
  const auth = decode(input.auth, "auth")
  if (auth.length !== AUTH_SECRET_BYTES) {
    throw new Error("auth must be 16 bytes")
  }
  if (typeof input.label !== "string") {
    throw new Error("label must be a string")
  }
}

function decode(value: string, name: string): Buffer {
  if (typeof value !== "string" || !BASE64URL.test(value)) {
    throw new Error(`${name} must be base64url`)
  }
  return Buffer.from(value, "base64url")
}
