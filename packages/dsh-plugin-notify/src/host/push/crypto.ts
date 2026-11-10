import { createCipheriv, createECDH, hkdfSync, randomBytes } from "node:crypto"

/** Record size of the single aes128gcm record this sender writes (RFC 8188). */
export const RECORD_SIZE = 4096

const PUBLIC_KEY_LENGTH = 65
const PRIVATE_KEY_LENGTH = 32
const AUTH_SECRET_LENGTH = 16
const SALT_LENGTH = 16
const RECORD_DELIMITER = 0x02

export interface EncryptInput {
  readonly plaintext: Uint8Array
  /** The user agent's ECDH public key as an uncompressed point. */
  readonly uaPublic: Uint8Array
  /** The 16-byte authentication secret of the subscription. */
  readonly authSecret: Uint8Array
  /** Injected for tests; a fresh random salt is used otherwise. */
  readonly salt?: Uint8Array
  /** Injected for tests; a fresh sender key pair is used otherwise. */
  readonly asPrivate?: Uint8Array
  /** Checked against `asPrivate` when both are injected. */
  readonly asPublic?: Uint8Array
}

/**
 * Encrypt one Web Push message body (RFC 8291 with the aes128gcm coding of
 * RFC 8188). The returned bytes are the HTTP entity body: the content coding
 * header followed by one AEAD record.
 */
export function encrypt(input: EncryptInput): Uint8Array {
  assertPublicKey(input.uaPublic, "uaPublic")
  assertLength(input.authSecret, AUTH_SECRET_LENGTH, "authSecret")
  const salt = input.salt ?? randomBytes(SALT_LENGTH)
  assertLength(salt, SALT_LENGTH, "salt")

  const ecdh = createECDH("prime256v1")
  let asPublic: Uint8Array
  if (input.asPrivate === undefined) {
    if (input.asPublic !== undefined) {
      throw new Error("asPublic needs asPrivate")
    }
    ecdh.generateKeys()
    asPublic = new Uint8Array(ecdh.getPublicKey())
  } else {
    assertLength(input.asPrivate, PRIVATE_KEY_LENGTH, "asPrivate")
    ecdh.setPrivateKey(input.asPrivate)
    const derived = new Uint8Array(ecdh.getPublicKey())
    if (input.asPublic === undefined) {
      asPublic = derived
    } else {
      assertPublicKey(input.asPublic, "asPublic")
      if (!equalBytes(derived, input.asPublic)) {
        throw new Error("asPublic does not match asPrivate")
      }
      asPublic = input.asPublic
    }
  }

  const plaintext = input.plaintext
  if (plaintext.length + 1 > RECORD_SIZE) {
    throw new Error("The push message does not fit one aes128gcm record")
  }

  const sharedSecret = new Uint8Array(ecdh.computeSecret(input.uaPublic))
  const ikm = hkdf(
    "sha256",
    sharedSecret,
    input.authSecret,
    concat(Buffer.from("WebPush: info\0", "ascii"), input.uaPublic, asPublic),
    32,
  )
  const cek = hkdf("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0", "ascii"), 16)
  const nonce = hkdf("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0", "ascii"), 12)

  const cipher = createCipheriv("aes-128-gcm", cek, nonce)
  const ciphertext = Buffer.concat([
    cipher.update(concat(plaintext, new Uint8Array([RECORD_DELIMITER]))),
    cipher.final(),
    cipher.getAuthTag(),
  ])

  const header = Buffer.alloc(SALT_LENGTH + 4 + 1 + PUBLIC_KEY_LENGTH)
  Buffer.from(salt).copy(header, 0)
  header.writeUInt32BE(RECORD_SIZE, SALT_LENGTH)
  header.writeUInt8(PUBLIC_KEY_LENGTH, SALT_LENGTH + 4)
  Buffer.from(asPublic).copy(header, SALT_LENGTH + 4 + 1)

  return new Uint8Array(Buffer.concat([header, ciphertext]))
}

/** HKDF-SHA-256: extract with `salt` and expand with `info` to `length` bytes. */
function hkdf(
  digest: string,
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Uint8Array {
  const output = hkdfSync(digest, ikm, salt, info, length)
  return new Uint8Array(output)
}

function concat(...parts: Uint8Array[]): Buffer {
  return Buffer.concat(parts.map((part) => Buffer.from(part)))
}

function assertLength(value: Uint8Array, length: number, name: string): void {
  if (value.length !== length) {
    throw new Error(`${name} must be ${length} bytes`)
  }
}

function assertPublicKey(value: Uint8Array, name: string): void {
  assertLength(value, PUBLIC_KEY_LENGTH, name)
  if (value[0] !== 0x04) {
    throw new Error(`${name} must be an uncompressed point`)
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index])
}
