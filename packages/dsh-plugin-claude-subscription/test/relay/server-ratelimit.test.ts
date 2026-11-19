import { afterEach, describe, expect, it } from "vitest"
import {
  anthropicError,
  completeStream,
  post,
  RelayHarness,
  replyStatus,
  replyStream,
} from "../support/relay-peers"

const harness = new RelayHarness()

afterEach(() => harness.dispose())

const UNIFIED = {
  "anthropic-ratelimit-unified-status": "allowed",
  "anthropic-ratelimit-unified-reset": "1795431600",
  "anthropic-ratelimit-unified-representative-claim": "seven_day",
  "anthropic-ratelimit-unified-7d-utilization": "0.18",
  "anthropic-ratelimit-unified-7d-reset": "1795431600",
  "anthropic-ratelimit-unified-7d-status": "allowed",
}

describe("the rate limit snapshot of an answer", () => {
  it("records the unified headers of a 200 stream", async () => {
    const peer = await harness.httpPeer((_, response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream", ...UNIFIED })
      response.end(completeStream())
    })
    const relay = await harness.relay(peer.url)
    const before = Date.now()
    expect((await post(relay)).status).toBe(200)
    const snapshot = relay.rateLimit
    expect(snapshot).toMatchObject({
      status: "allowed",
      resetsAt: 1_795_431_600_000,
      representativeClaim: "seven_day",
      windows: [
        { kind: "seven_day", utilization: 0.18, resetsAt: 1_795_431_600_000, status: "allowed" },
      ],
    })
    expect(snapshot?.observedAt).toBeGreaterThanOrEqual(before)
    expect(snapshot?.observedAt).toBeLessThanOrEqual(Date.now())
  })

  it("records them on a 429 answer too", async () => {
    const peer = await harness.httpPeer((_, response) =>
      replyStatus(response, 429, anthropicError("slow down"), {
        ...UNIFIED,
        "anthropic-ratelimit-unified-status": "rejected",
        "anthropic-ratelimit-unified-7d-status": "rejected",
      }),
    )
    const relay = await harness.relay(peer.url)
    expect((await post(relay)).status).toBe(429)
    expect(relay.rateLimit?.status).toBe("rejected")
    expect(relay.rateLimit?.windows[0]?.status).toBe("rejected")
  })

  it("stays null without unified headers", async () => {
    const peer = await harness.httpPeer((_, response) => replyStream(response))
    const relay = await harness.relay(peer.url)
    expect(relay.rateLimit).toBeNull()
    await post(relay)
    expect(relay.rateLimit).toBeNull()
  })

  it("stays null when the headers cannot be read", async () => {
    const peer = await harness.httpPeer((_, response) =>
      replyStatus(response, 500, "", {
        "anthropic-ratelimit-unified-status": "later",
        "anthropic-ratelimit-unified-7d-utilization": "many",
      }),
    )
    const relay = await harness.relay(peer.url)
    await post(relay)
    expect(relay.rateLimit).toBeNull()
  })
})
