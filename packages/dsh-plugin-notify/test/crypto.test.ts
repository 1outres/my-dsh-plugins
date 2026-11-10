import { describe, expect, it } from "vitest"
import { encrypt } from "../src/host/push/crypto"

// RFC 8291 Appendix A test vector.
const PLAINTEXT = "When I grow up, I want to be a watermelon"
const AS_PUBLIC =
  "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"
const AS_PRIVATE = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"
const UA_PUBLIC =
  "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"
const SALT = "DGv6ra1nlYgDCS1FRnbzlw"
const AUTH_SECRET = "BTBZMqHH6r4Tts7J_aSIgg"
const BODY =
  "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"

const decode = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, "base64url"))

describe("encrypt", () => {
  it("matches the RFC 8291 Appendix A vector", () => {
    const body = encrypt({
      plaintext: new TextEncoder().encode(PLAINTEXT),
      uaPublic: decode(UA_PUBLIC),
      authSecret: decode(AUTH_SECRET),
      salt: decode(SALT),
      asPrivate: decode(AS_PRIVATE),
      asPublic: decode(AS_PUBLIC),
    })

    expect(Buffer.from(body).toString("base64url")).toBe(BODY)
  })

  it("writes a single aes128gcm header with the sender public key", () => {
    const asPublic = decode(AS_PUBLIC)
    const body = encrypt({
      plaintext: new TextEncoder().encode("hello"),
      uaPublic: decode(UA_PUBLIC),
      authSecret: decode(AUTH_SECRET),
      salt: decode(SALT),
      asPrivate: decode(AS_PRIVATE),
      asPublic,
    })

    expect(Buffer.from(body.subarray(0, 16)).toString("base64url")).toBe(SALT)
    expect(Buffer.from(body).readUInt32BE(16)).toBe(4096)
    expect(body[20]).toBe(65)
    expect(Array.from(body.subarray(21, 86))).toEqual(Array.from(asPublic))
  })

  it("generates a sender key pair when none is injected", () => {
    const body = encrypt({
      plaintext: new TextEncoder().encode("hello"),
      uaPublic: decode(UA_PUBLIC),
      authSecret: decode(AUTH_SECRET),
    })

    expect(body.length).toBeGreaterThan(86)
    expect(body[20]).toBe(65)
    expect(body[21]).toBe(4)
  })

  it("rejects malformed inputs", () => {
    const base = {
      plaintext: new TextEncoder().encode("hello"),
      uaPublic: decode(UA_PUBLIC),
      authSecret: decode(AUTH_SECRET),
    }

    expect(() => encrypt({ ...base, uaPublic: new Uint8Array(64) })).toThrow()
    expect(() => encrypt({ ...base, authSecret: new Uint8Array(8) })).toThrow()
    expect(() => encrypt({ ...base, salt: new Uint8Array(8) })).toThrow()
    expect(() => encrypt({ ...base, asPublic: decode(AS_PUBLIC) })).toThrow()
    expect(() =>
      encrypt({
        ...base,
        asPrivate: decode(AS_PRIVATE),
        asPublic: decode(UA_PUBLIC),
      }),
    ).toThrow()
  })

  it("rejects a plaintext that does not fit one record", () => {
    expect(() =>
      encrypt({
        plaintext: new Uint8Array(4096),
        uaPublic: decode(UA_PUBLIC),
        authSecret: decode(AUTH_SECRET),
      }),
    ).toThrow()
  })
})
