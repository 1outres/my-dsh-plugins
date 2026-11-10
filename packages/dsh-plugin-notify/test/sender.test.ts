import { createECDH, randomBytes } from "node:crypto"
import { describe, expect, it } from "vitest"
import { createPushSender, type FetchLike, topicOf } from "../src/host/push/sender"
import { generateVapidKeys, type VapidKeys } from "../src/host/push/vapid"
import type { PwaPushMessage } from "../src/shared/protocol"

const keys = generateVapidKeys()

function subscription() {
  const ua = createECDH("prime256v1")
  ua.generateKeys()
  return {
    endpoint: "https://push.example.com/send/abc",
    p256dh: ua.getPublicKey().toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
    label: "Safari on iPhone",
    createdAt: 1,
  }
}

const message: PwaPushMessage = {
  dshPwa: 1,
  title: "Approval needed",
  options: {
    body: "Fix login · bash",
    tag: "dsh-notify:approval:s1",
    renotify: true,
    data: { dshPwa: 1, payload: { sessionId: "s1" } },
  },
}

interface Call {
  input: string
  init: { method: string; headers: Record<string, string>; body: Uint8Array }
}

function fakeFetch(status: number, handler?: () => void): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = []
  const fetch: FetchLike = async (input, init) => {
    calls.push({ input, init })
    handler?.()
    return { status }
  }
  return { fetch, calls }
}

function senderWith(fetch: FetchLike, vapid: () => Promise<VapidKeys> = async () => keys) {
  return createPushSender({
    fetch,
    vapid,
    subject: () => "mailto:ops@example.com",
  })
}

describe("createPushSender", () => {
  it("posts one encrypted message with the Web Push headers", async () => {
    const { fetch, calls } = fakeFetch(201)
    const result = await senderWith(fetch).send(subscription(), message, {
      ttlSeconds: 3600,
      urgency: "high",
      topic: topicOf("dsh-notify:approval:s1"),
    })

    expect(result).toBe("sent")
    expect(calls).toHaveLength(1)
    const call = calls[0] as Call
    expect(call.input).toBe("https://push.example.com/send/abc")
    expect(call.init.method).toBe("POST")
    expect(call.init.headers["Content-Encoding"]).toBe("aes128gcm")
    expect(call.init.headers["Content-Type"]).toBe("application/octet-stream")
    expect(call.init.headers.TTL).toBe("3600")
    expect(call.init.headers.Urgency).toBe("high")
    expect(call.init.headers.Topic).toBe(topicOf("dsh-notify:approval:s1"))
    expect(call.init.headers.Authorization.startsWith("vapid t=")).toBe(true)
    expect(call.init.headers.Authorization.endsWith(`k=${keys.publicKey}`)).toBe(true)
    expect(call.init.body).toBeInstanceOf(Uint8Array)
    expect(Buffer.from(call.init.body.subarray(20, 21))[0]).toBe(65)
  })

  it("reports a subscription the push service deleted", async () => {
    expect(
      await senderWith(fakeFetch(404).fetch).send(subscription(), message, {
        ttlSeconds: 60,
        urgency: "normal",
      }),
    ).toBe("gone")
    expect(
      await senderWith(fakeFetch(410).fetch).send(subscription(), message, {
        ttlSeconds: 60,
        urgency: "normal",
      }),
    ).toBe("gone")
  })

  it("reports a refused push with its status", async () => {
    const result = await senderWith(fakeFetch(500).fetch).send(subscription(), message, {
      ttlSeconds: 60,
      urgency: "normal",
    })

    expect(result).toEqual({ failed: { status: 500, message: expect.any(String) } })
  })

  it("reports a network failure with status zero", async () => {
    const fetch: FetchLike = async () => {
      throw new Error("offline")
    }
    const result = await senderWith(fetch).send(subscription(), message, {
      ttlSeconds: 60,
      urgency: "normal",
    })

    expect(result).toEqual({ failed: { status: 0, message: "offline" } })
  })

  it("does not send without VAPID keys", async () => {
    const { fetch, calls } = fakeFetch(201)
    const sender = senderWith(fetch, async () => {
      throw new Error("no keys")
    })
    await expect(
      sender.send(subscription(), message, { ttlSeconds: 60, urgency: "normal" }),
    ).rejects.toThrow("no keys")
    expect(calls).toHaveLength(0)
  })
})

describe("topicOf", () => {
  it("is url-safe and at most 32 characters", () => {
    const topic = topicOf("dsh-notify:plan-review:session-123")
    expect(topic).toMatch(/^[A-Za-z0-9_-]{1,32}$/)
    expect(topicOf("a")).not.toBe(topicOf("b"))
  })
})
