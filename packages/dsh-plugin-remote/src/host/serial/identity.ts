import { createHash, createPublicKey, type KeyObject, verify } from "node:crypto"

/** SPKI DER prefix of an Ed25519 public key; the 32 raw bytes follow it. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex")

/** Domain separation prefix of the handshake signature. */
const AUTH_PREFIX = "dsh-serial-agent auth v1\n"

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u

export class SerialIdentityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SerialIdentityError"
  }
}

export interface SerialAgentKey {
  /** Standard base64 of the 32 raw public key bytes, as the user pasted it. */
  readonly publicKey: string
  readonly raw: Buffer
  readonly key: KeyObject
  readonly fingerprint: string
}

/** Parse the public key text from the plugin config into a verifiable key. */
export function parseAgentPublicKey(text: string): SerialAgentKey {
  const raw = decodeBase64(text, "public key")
  if (raw.length !== 32) {
    throw new SerialIdentityError(
      `public key must be base64 of exactly 32 bytes, not ${String(raw.length)} bytes`,
    )
  }
  const key = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: "der",
    type: "spki",
  })
  return { publicKey: text, raw, key, fingerprint: fingerprintOf(raw) }
}

/** OpenSSH-style fingerprint: "SHA256:" plus unpadded base64 of the SHA-256 digest. */
export function fingerprintOf(raw: Buffer): string {
  return `SHA256:${createHash("sha256").update(raw).digest("base64").replace(/=+$/u, "")}`
}

/** Verify the handshake signature over the nonce text exactly as received. */
export function verifyAuthSignature(
  nonceText: string,
  signatureBase64: string,
  key: KeyObject,
): boolean {
  if (!BASE64.test(signatureBase64)) return false
  const signature = Buffer.from(signatureBase64, "base64")
  if (signature.length !== 64) return false
  return verify(null, Buffer.from(`${AUTH_PREFIX}${nonceText}`, "utf8"), key, signature)
}

function decodeBase64(text: string, label: string): Buffer {
  if (!BASE64.test(text)) {
    throw new SerialIdentityError(`${label} must be standard base64 with padding`)
  }
  return Buffer.from(text, "base64")
}
