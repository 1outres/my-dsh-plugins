import { createPublicKey, verify } from "node:crypto"
import { describe, expect, it } from "vitest"
import { generateVapidKeys, vapidAuthorization } from "../src/host/push/vapid"

// SPKI prefix for a P-256 uncompressed public point.
const SPKI_PREFIX = Buffer.from("3059301306072a8648ce3d020106082a8648ce3d030107034200", "hex")

function publicKeyObject(publicKey: string) {
  const raw = Buffer.from(publicKey, "base64url")
  return createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, raw]),
    format: "der",
    type: "spki",
  })
}

function parse(header: string) {
  const match = /^vapid t=([^,]+), k=(.+)$/.exec(header)
  if (match === null) throw new Error("not a vapid header")
  return { token: match[1] as string, publicKey: match[2] as string }
}

function decodePart(value: string): unknown {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
}

describe("generateVapidKeys", () => {
  it("makes a P-256 key pair and a 65-byte public point", () => {
    const keys = generateVapidKeys()
    const publicKey = Buffer.from(keys.publicKey, "base64url")

    expect(publicKey).toHaveLength(65)
    expect(publicKey[0]).toBe(4)
    expect(Buffer.from(keys.privateKey, "base64url").length).toBeGreaterThan(0)
  })

  it("makes a new pair on every call", () => {
    expect(generateVapidKeys().publicKey).not.toBe(generateVapidKeys().publicKey)
  })
})

describe("vapidAuthorization", () => {
  const keys = generateVapidKeys()
  const now = 1_700_000_000_000

  it("builds a signed ES256 token with the right claims", () => {
    const header = vapidAuthorization("https://push.example.com:8443/send/abc", keys, {
      subject: "mailto:ops@example.com",
      now,
    })
    const { token, publicKey } = parse(header)
    const [encodedHeader, encodedClaims, encodedSignature] = token.split(".")

    expect(publicKey).toBe(keys.publicKey)
    expect(decodePart(encodedHeader as string)).toEqual({ typ: "JWT", alg: "ES256" })
    expect(decodePart(encodedClaims as string)).toEqual({
      aud: "https://push.example.com:8443",
      exp: Math.floor(now / 1000) + 12 * 60 * 60,
      sub: "mailto:ops@example.com",
    })

    const valid = verify(
      "sha256",
      Buffer.from(`${encodedHeader}.${encodedClaims}`),
      { key: publicKeyObject(keys.publicKey), dsaEncoding: "ieee-p1363" },
      Buffer.from(encodedSignature as string, "base64url"),
    )
    expect(valid).toBe(true)
  })

  it("rejects a token signed by another key", () => {
    const header = vapidAuthorization("https://push.example.com/send/abc", generateVapidKeys(), {
      subject: "https://github.com/1outres/my-dsh-plugins",
      now,
    })
    const { token } = parse(header)
    const [encodedHeader, encodedClaims, encodedSignature] = token.split(".")

    const valid = verify(
      "sha256",
      Buffer.from(`${encodedHeader}.${encodedClaims}`),
      { key: publicKeyObject(keys.publicKey), dsaEncoding: "ieee-p1363" },
      Buffer.from(encodedSignature as string, "base64url"),
    )
    expect(valid).toBe(false)
  })
})
