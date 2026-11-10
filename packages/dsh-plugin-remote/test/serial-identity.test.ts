import { generateKeyPairSync, sign } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  fingerprintOf,
  parseAgentPublicKey,
  SerialIdentityError,
  verifyAuthSignature,
} from "../src/host/serial/identity"

const ZERO_KEY = Buffer.alloc(32).toString("base64")

describe("serial agent identity", () => {
  it("turns the 32 raw bytes into a key and a fingerprint", () => {
    const key = parseAgentPublicKey(ZERO_KEY)
    expect(key.raw).toHaveLength(32)
    expect(key.fingerprint).toBe("SHA256:Zmh6rfhivXdsj8GLjp+OIAiXFIVu4jOzkCpZHQ1fKSU")
    expect(key.key.asymmetricKeyType).toBe("ed25519")
  })

  it("matches the fingerprint of a generated key", () => {
    const { publicKey } = generateKeyPairSync("ed25519")
    const der = publicKey.export({ format: "der", type: "spki" })
    const raw = Buffer.from(der.subarray(der.length - 32))
    expect(parseAgentPublicKey(raw.toString("base64")).fingerprint).toBe(fingerprintOf(raw))
  })

  it("rejects text that is not base64", () => {
    expect(() => parseAgentPublicKey("not base64!")).toThrow(SerialIdentityError)
  })

  it("rejects a key that is not 32 bytes", () => {
    expect(() => parseAgentPublicKey(Buffer.alloc(31).toString("base64"))).toThrow(/32 bytes/)
  })

  it("verifies the handshake signature over the nonce text", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519")
    const der = publicKey.export({ format: "der", type: "spki" })
    const key = parseAgentPublicKey(Buffer.from(der.subarray(der.length - 32)).toString("base64"))
    const nonce = Buffer.alloc(32, 3).toString("base64")
    const signature = sign(
      null,
      Buffer.from(`dsh-serial-agent auth v1\n${nonce}`, "utf8"),
      privateKey,
    ).toString("base64")
    expect(verifyAuthSignature(nonce, signature, key.key)).toBe(true)
    expect(verifyAuthSignature(nonce, Buffer.alloc(64).toString("base64"), key.key)).toBe(false)
    const otherNonce = Buffer.alloc(32, 4).toString("base64")
    expect(verifyAuthSignature(otherNonce, signature, key.key)).toBe(false)
    expect(verifyAuthSignature(nonce, "not base64!", key.key)).toBe(false)
  })
})
