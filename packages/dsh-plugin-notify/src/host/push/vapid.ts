import { createPrivateKey, generateKeyPairSync, type KeyObject, sign } from "node:crypto"

/** VAPID keys as stored strings: base64url public point and PKCS#8 private key. */
export interface VapidKeys {
  readonly publicKey: string
  readonly privateKey: string
}

export interface VapidOptions {
  /** VAPID `sub` claim: a mailto: or https: URL. */
  readonly subject: string
  /** Clock in milliseconds; injected for tests. */
  readonly now?: number
}

/** Lifetime of one VAPID token, as RFC 8292 allows at most 24 hours. */
export const VAPID_LIFETIME_SECONDS = 12 * 60 * 60

/** Make a new P-256 key pair for signing Web Push requests. */
export function generateVapidKeys(): VapidKeys {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
  const privateKey = pair.privateKey.export({ format: "der", type: "pkcs8" })
  return {
    publicKey: rawPublicKey(pair.publicKey),
    privateKey: Buffer.from(privateKey).toString("base64url"),
  }
}

/**
 * Build the `Authorization` header value for one push request (RFC 8292):
 * an ES256 JWT for the endpoint origin plus the public key the browser needs
 * to verify it.
 */
export function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  options: VapidOptions,
): string {
  const audience = new URL(endpoint).origin
  const header = encode({ typ: "JWT", alg: "ES256" })
  const claims = encode({
    aud: audience,
    exp: Math.floor((options.now ?? Date.now()) / 1000) + VAPID_LIFETIME_SECONDS,
    sub: options.subject,
  })
  const signingInput = `${header}.${claims}`
  const signature = sign("sha256", Buffer.from(signingInput), {
    key: privateKeyObject(keys.privateKey),
    dsaEncoding: "ieee-p1363",
  })
  return `vapid t=${signingInput}.${Buffer.from(signature).toString("base64url")}, k=${keys.publicKey}`
}

function privateKeyObject(privateKey: string): KeyObject {
  return createPrivateKey({
    key: Buffer.from(privateKey, "base64url"),
    format: "der",
    type: "pkcs8",
  })
}

function rawPublicKey(key: KeyObject): string {
  const jwk = key.export({ format: "jwk" })
  if (typeof jwk.x !== "string" || typeof jwk.y !== "string") {
    throw new Error("The VAPID key is not a P-256 key")
  }
  const point = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, "base64url"),
    Buffer.from(jwk.y, "base64url"),
  ])
  return point.toString("base64url")
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}
