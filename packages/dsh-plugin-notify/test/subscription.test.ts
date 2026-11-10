import { describe, expect, it } from "vitest"
import { validateSubscription } from "../src/host/push/subscription"

const P256DH =
  "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"
const AUTH = "BTBZMqHH6r4Tts7J_aSIgg"
const ENDPOINT = "https://push.example.com/send/abc"

const valid = { endpoint: ENDPOINT, p256dh: P256DH, auth: AUTH, label: "Safari on iPhone" }

describe("validateSubscription", () => {
  it("accepts a well-formed subscription", () => {
    expect(() => validateSubscription(valid)).not.toThrow()
  })

  it("requires an object", () => {
    expect(() => validateSubscription(null as never)).toThrow("object")
    expect(() => validateSubscription(undefined as never)).toThrow("object")
  })

  it("requires an https endpoint", () => {
    expect(() => validateSubscription({ ...valid, endpoint: "http://push.example.com/a" })).toThrow(
      "https",
    )
    expect(() => validateSubscription({ ...valid, endpoint: "not a url" })).toThrow("https")
  })

  it("requires a 65-byte uncompressed p256dh point", () => {
    expect(() => validateSubscription({ ...valid, p256dh: "AAAA" })).toThrow("p256dh")
    expect(() => validateSubscription({ ...valid, p256dh: `A${P256DH.slice(1)}` })).toThrow(
      "p256dh",
    )
    expect(() => validateSubscription({ ...valid, p256dh: "***" })).toThrow("p256dh")
  })

  it("requires a 16-byte auth secret", () => {
    expect(() => validateSubscription({ ...valid, auth: "AAAA" })).toThrow("auth")
    expect(() => validateSubscription({ ...valid, auth: "***" })).toThrow("auth")
  })

  it("requires a label string", () => {
    expect(() => validateSubscription({ ...valid, label: undefined as unknown as string })).toThrow(
      "label",
    )
  })
})
