import { gunzipSync, inflateSync } from "node:zlib"
import { afterEach, describe, expect, it } from "vitest"
import type { Peer } from "../support/relay-peers"
import {
  anthropicError,
  type PeerReply,
  post,
  RelayHarness,
  replyStatus,
  replyStream,
} from "../support/relay-peers"

const harness = new RelayHarness()

afterEach(() => harness.dispose())

const PAYLOAD = JSON.stringify({ messages: [{ role: "user", content: "fixture λ ".repeat(600) }] })

function sized(bytes: number): string {
  return `{"text":"${"x".repeat(bytes - 11)}"}`
}

async function gzipRelay(reply: PeerReply, env: Record<string, string> = {}) {
  const peer = await harness.httpPeer(reply)
  const relay = await harness.relay(peer.url, { env }, { gzipOrigins: [peer.url] })
  return { peer, relay }
}

function firstBody(peer: Peer): Buffer {
  return peer.calls[0]?.body as Buffer
}

describe("request gzip", () => {
  it("compresses at the size limit, and sends one member with one length", async () => {
    const payload = sized(4096)
    const { peer, relay } = await gzipRelay((_, response) => replyStatus(response, 200))

    const answer = await post(relay, { path: "/v1/messages?beta=true", body: payload })

    const [call] = peer.calls
    expect(answer.status).toBe(200)
    expect(relay.failure).toBeNull()
    expect(call?.url).toBe("/v1/messages?beta=true")
    expect(call?.headers["content-encoding"]).toBe("gzip")
    expect(call?.headers["accept-encoding"]).toBe("identity")
    expect(Number(call?.headers["content-length"])).toBe(call?.body.length)
    expect(call?.body.subarray(4, 8).equals(Buffer.alloc(4))).toBe(true)
    const decoded = gunzipSync(firstBody(peer))
    expect(decoded.subarray(0, payload.length).toString()).toBe(payload)
    expect(decoded[payload.length]).toBe(0x0a)
    expect(JSON.parse(decoded.toString())).toEqual(JSON.parse(payload))
  })

  it("sends a smaller body as it is", async () => {
    const payload = sized(4095)
    const { peer, relay } = await gzipRelay((_, response) => replyStatus(response, 200))

    await post(relay, { body: payload })

    expect(peer.calls[0]?.headers["content-encoding"]).toBeUndefined()
    expect(firstBody(peer).toString()).toBe(payload)
  })

  it("does not compress a body that already has an encoding", async () => {
    const { peer, relay } = await gzipRelay((_, response) => replyStatus(response, 200))

    await post(relay, { headers: { "cOnTeNt-EnCoDiNg": "identity" }, body: PAYLOAD })

    expect(peer.calls[0]?.headers["content-encoding"]).toBe("identity")
    expect(firstBody(peer).toString()).toBe(PAYLOAD)
  })

  it.each(["0", "false", "NO", "off"])("is turned off by the setting %s", async (value) => {
    const { peer, relay } = await gzipRelay((_, response) => replyStatus(response, 200), {
      CLAUDE_CODE_GZIP_REQUEST_BODIES: value,
    })

    await post(relay, { body: PAYLOAD })

    expect(peer.calls[0]?.headers["content-encoding"]).toBeUndefined()
    expect(firstBody(peer).toString()).toBe(PAYLOAD)
  })

  it("does not compress for an origin outside the policy", async () => {
    const peer = await harness.httpPeer((_, response) => replyStatus(response, 200))
    const relay = await harness.relay(peer.url)

    await post(relay, { body: PAYLOAD })

    expect(peer.calls[0]?.headers["content-encoding"]).toBeUndefined()
  })
})

describe("a gzip rejection", () => {
  it.each<[number, Record<string, string>, string, string]>([
    [415, { "Request-Id": "req_fixture" }, "unsupported", "unsupported"],
    [
      400,
      { "Request-Id": "req_fixture" },
      anthropicError("Unsupported Content-Encoding: gzip"),
      "Unsupported Content-Encoding: gzip",
    ],
    [
      400,
      { "CF-Ray": "fixture" },
      anthropicError("The request body is not valid JSON: fixture"),
      "The request body is not valid JSON: fixture",
    ],
    [400, {}, "bad json: EOF", "bad json: EOF"],
    [403, {}, "not JSON", "not JSON"],
  ])("surfaces status %d with no resend", async (status, headers, body, text) => {
    const { peer, relay } = await gzipRelay((_, response) =>
      replyStatus(response, status, body, headers),
    )

    const answer = await post(relay, { headers: { "X-Fixture": "preserved" }, body: PAYLOAD })

    expect(answer.status).toBe(status)
    expect(answer.body.toString()).toBe(body)
    expect(peer.calls).toHaveLength(1)
    expect(peer.calls[0]?.headers["content-encoding"]).toBe("gzip")
    expect(relay.status).toBe(status)
    expect(relay.errorText()).toBe(text)
    expect(relay.failure).toBeNull()
  })

  it("does not stop the next relay from compressing", async () => {
    const peer = await harness.httpPeer((_, response) => replyStatus(response, 415, "no"))
    const options = { gzipOrigins: [peer.url] }
    const rejected = await harness.relay(peer.url, {}, options)
    const next = await harness.relay(peer.url, {}, options)

    await post(rejected, { body: PAYLOAD })
    await post(next, { body: PAYLOAD })

    expect(peer.calls.map((call) => call.headers["content-encoding"])).toEqual(["gzip", "gzip"])
  })

  it("forwards a connection-close error that was read in full", async () => {
    const body = anthropicError("prompt is too long")
    const peer = await harness.socketPeer((socket) => {
      socket.once("data", () => {
        socket.end(
          `HTTP/1.0 400 Bad Request\r\nRequest-Id: req_fixture\r\nConnection: close\r\nContent-Length: ${body.length}\r\n\r\n${body}`,
        )
      })
    })
    const relay = await harness.relay(peer.url, {}, { gzipOrigins: [peer.url] })

    const answer = await post(relay, { body: PAYLOAD })

    expect(answer.status).toBe(400)
    expect(answer.body.toString()).toBe(body)
    expect(relay.errorText()).toBe("prompt is too long")
    expect(relay.failure).toBeNull()
  })
})

describe("a compressed stream", () => {
  it("still answers with the stream", async () => {
    const { peer, relay } = await gzipRelay((_, response) => replyStream(response))

    const answer = await post(relay, { body: PAYLOAD })

    expect(answer.status).toBe(200)
    expect(relay.capture.complete).toBe(true)
    expect(peer.calls).toHaveLength(1)
    expect(() => inflateSync(firstBody(peer))).toThrow()
  })
})
