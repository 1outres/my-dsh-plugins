import { once } from "node:events"
import { afterEach, describe, expect, it, vi } from "vitest"
import { FailureCode, NativeFailure } from "../../src/errors"
import { createRelay } from "../../src/relay/relay"
import { QUERIED_TURN_MISMATCH } from "../../src/relay/rewrite"
import {
  anthropicError,
  closed,
  completeStream,
  MESSAGE_START,
  neverEnds,
  openClient,
  post,
  RelayHarness,
  replyStatus,
  replyStream,
  sseFrame,
} from "../support/relay-peers"

const harness = new RelayHarness()

afterEach(() => harness.dispose())

const CONSUMED = "DSH_MODEL_ADMISSION_CONSUMED"

describe("createRelay", () => {
  it("listens on loopback under a random route", async () => {
    const peer = await harness.httpPeer((_, response) => replyStatus(response, 200))
    const relay = await createRelay({
      upstream: peer.url,
      timeoutMs: 1_000,
      queried: [],
      oneShot: false,
      env: {},
    })
    const other = await createRelay({
      upstream: peer.url,
      timeoutMs: 1_000,
      queried: [],
      oneShot: false,
      env: {},
    })
    try {
      expect(relay.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/admit\/[\w-]{43}$/)
      expect(new URL(relay.url).pathname).not.toBe(new URL(other.url).pathname)
    } finally {
      await Promise.all([relay.close(), other.close()])
    }
  })

  it.each(["http://api.anthropic.com", "https://user:hunter2@api.anthropic.com"])(
    "rejects the upstream %s",
    async (upstream) => {
      const created = createRelay({ upstream, timeoutMs: 1, queried: [], oneShot: false, env: {} })
      await expect(created).rejects.toBeInstanceOf(NativeFailure)
      await expect(created).rejects.toMatchObject({ code: FailureCode.relayError })
    },
  )

  it("accepts a timeout that is not a whole number", async () => {
    const peer = await harness.httpPeer((_, response) => replyStream(response))
    const relay = await harness.relay(peer.url, { timeoutMs: 1_500.5 })
    expect((await post(relay)).status).toBe(200)
  })

  it("rejects an unusable proxy instead of connecting directly", async () => {
    const created = createRelay({
      upstream: "https://api.example.com",
      timeoutMs: 1,
      queried: [],
      oneShot: false,
      env: { HTTPS_PROXY: "socks5://user:hunter2@proxy.test:1080" },
    })
    await expect(created).rejects.toMatchObject({ code: FailureCode.relayError })
    await expect(created).rejects.not.toThrow("hunter2")
  })
})

describe("one admission per relay", () => {
  it("forwards the first request and denies the next one locally", async () => {
    const peer = await harness.httpPeer((_, response) => replyStream(response))
    const relay = await harness.relay(peer.url)

    const first = await post(relay)
    const second = await post(relay)

    expect(first.status).toBe(200)
    expect(first.body.toString()).toBe(completeStream())
    expect(second.status).toBe(400)
    expect(second.headers["content-type"]).toBe("application/json")
    expect(JSON.parse(second.body.toString())).toEqual({
      type: "error",
      error: { type: "invalid_request_error", message: CONSUMED },
    })
    expect(peer.calls).toHaveLength(1)
    expect(relay.used).toBe(true)
    expect(relay.denied).toBe(1)
    expect(relay.status).toBe(200)
    expect(relay.failure).toBeNull()
    expect(relay.capture.complete).toBe(true)
    expect(relay.capture.message?.id).toBe("first")
  })

  it("admits exactly one of many parallel requests", async () => {
    const peer = await harness.httpPeer((_, response) => replyStream(response))
    const relay = await harness.relay(peer.url)

    const results = await Promise.all(Array.from({ length: 8 }, () => post(relay)))

    expect(results.filter((result) => result.status === 200)).toHaveLength(1)
    expect(results.filter((result) => result.status === 400)).toHaveLength(7)
    expect(peer.calls).toHaveLength(1)
    expect(relay.denied).toBe(7)
  })

  it("denies at once while the admitted request is still streaming", async () => {
    const peer = await harness.httpPeer(async (_, response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" })
      response.write(sseFrame(MESSAGE_START))
      await neverEnds()
    })
    const relay = await harness.relay(peer.url)
    const { request, response } = openClient(relay)
    request.end("{}")
    await response

    const denied = await post(relay)

    expect(denied.status).toBe(400)
    expect(denied.body.toString()).toContain(CONSUMED)
    expect(peer.calls).toHaveLength(1)
  })

  it("answers a large denied body with the denial, not a reset", async () => {
    const peer = await harness.httpPeer((_, response) => replyStream(response))
    const relay = await harness.relay(peer.url)
    await post(relay)

    const denied = await post(relay, { body: Buffer.alloc(8 * 1024 * 1024, 0x20) })

    expect(denied.status).toBe(400)
    expect(denied.broken).toBe(false)
    expect(denied.body.toString()).toContain(CONSUMED)
  })

  it("does not spend the admission on a wrong route, a browser or a probe", async () => {
    const peer = await harness.httpPeer((_, response) => replyStream(response))
    const relay = await harness.relay(peer.url)

    const wrongRoute = await post(relay, { path: "/v1/other" })
    const browser = await post(relay, { headers: { Origin: "https://evil.test" } })
    const probe = await post(relay, { method: "GET", path: "/api/hello" })
    const missingPrefix = await fetchWithoutRoute(relay.url)

    expect([wrongRoute.status, browser.status, probe.status, missingPrefix]).toEqual([
      404, 404, 501, 404,
    ])
    expect(peer.calls).toHaveLength(0)
    expect(relay.used).toBe(false)
    expect(relay.denied).toBe(0)

    expect((await post(relay)).status).toBe(200)
    expect(peer.calls).toHaveLength(1)
  })

  async function fetchWithoutRoute(relayUrl: string): Promise<number> {
    const { origin } = new URL(relayUrl)
    const response = await fetch(`${origin}/v1/messages`, { method: "POST", body: "{}" })
    await response.arrayBuffer()
    return response.status
  }
})

describe("what the upstream receives", () => {
  it("keeps request identity and replaces the transfer fields", async () => {
    const peer = await harness.httpPeer((_, response) => replyStream(response))
    const relay = await harness.relay(`${peer.url}/base/`)

    await post(relay, {
      path: "/v1/messages?beta=true",
      headers: {
        Authorization: "Bearer fixture-token",
        "X-Fixture": "preserved",
        "Accept-Encoding": "br",
        "Proxy-Authorization": "Basic secret",
        "Proxy-Connection": "keep-alive",
      },
      body: '{"model":"m"}',
    })

    const [call] = peer.calls
    expect(call?.method).toBe("POST")
    expect(call?.url).toBe("/base/v1/messages?beta=true")
    expect(call?.headers.authorization).toBe("Bearer fixture-token")
    expect(call?.headers["x-fixture"]).toBe("preserved")
    expect(call?.headers["accept-encoding"]).toBe("identity")
    expect(call?.headers["proxy-authorization"]).toBeUndefined()
    expect(call?.headers["proxy-connection"]).toBeUndefined()
    expect(call?.headers.host).toBe(`127.0.0.1:${peer.port}`)
    expect(call?.body.toString()).toBe('{"model":"m"}')
    expect(call?.rawHeaders.filter((name) => name.toLowerCase() === "content-length")).toHaveLength(
      1,
    )
  })

  it("assembles a chunked client body and sends a content length", async () => {
    const peer = await harness.httpPeer((_, response) => replyStream(response))
    const relay = await harness.relay(peer.url)
    const { request, response } = openClient(relay)
    request.write('{"a":')
    await new Promise((resolve) => setTimeout(resolve, 20))
    request.end("1}")
    await response

    await vi.waitFor(() => expect(peer.calls).toHaveLength(1))
    expect(peer.calls[0]?.body.toString()).toBe('{"a":1}')
    expect(peer.calls[0]?.headers["content-length"]).toBe("7")
    expect(peer.calls[0]?.headers["transfer-encoding"]).toBeUndefined()
  })

  it("does not reuse a pooled connection", async () => {
    const peer = await harness.httpPeer((_, response) => replyStream(response))
    const relays = [await harness.relay(peer.url), await harness.relay(peer.url)]
    for (const relay of relays) await post(relay)
    const [first, second] = peer.calls
    expect(first?.socket).not.toBe(second?.socket)
    expect(first?.headers.connection).toBe("close")
  })

  it("does not contact the upstream when the client leaves during the body", async () => {
    const peer = await harness.httpPeer((_, response) => replyStream(response))
    const relay = await harness.relay(peer.url)
    const { request } = openClient(relay, { headers: { "Content-Length": "100" } })
    request.write("{")
    await vi.waitFor(() => expect(relay.used).toBe(true))
    request.destroy()

    await vi.waitFor(() => expect(relay.failure).toBe("ClientDisconnected"))
    expect(peer.calls).toHaveLength(0)
  })

  it("fails when a client stops sending its body", async () => {
    const peer = await harness.httpPeer((_, response) => replyStream(response))
    const relay = await harness.relay(peer.url, { timeoutMs: 100 })
    const { request } = openClient(relay, { headers: { "Content-Length": "100" } })
    request.write("{")

    await vi.waitFor(() => expect(relay.failure).toBe("ClientStalled"))
    expect(peer.calls).toHaveLength(0)
  })
})

describe("the rewrite modules", () => {
  const body = JSON.stringify({
    model: "fixture",
    tools: [{ name: "list_things", input_schema: { type: "object" } }],
    messages: [{ role: "user", content: [{ type: "text", text: "fixture" }] }],
  })

  it("rewrite the admitted request", async () => {
    const peer = await harness.httpPeer((_, response) => replyStream(response))
    const relay = await harness.relay(peer.url, {
      queried: [{ type: "text", text: "fixture" }],
    })

    expect((await post(relay, { body })).status).toBe(200)

    const sent = JSON.parse(peer.calls[0]?.body.toString() ?? "")
    expect(sent.tools[0].eager_input_streaming).toBe(true)
    expect(relay.failure).toBeNull()
    expect(relay.unrestored).toBeNull()
  })

  it("record a queried turn that cannot be matched, and still forward", async () => {
    const peer = await harness.httpPeer((_, response) => replyStream(response))
    const result = { type: "tool_result", tool_use_id: "t1", content: "output" }
    const relay = await harness.relay(peer.url, { queried: [result] })
    const reshaped = JSON.stringify({
      model: "fixture",
      messages: [
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "t1", name: "list_things", input: {} }],
        },
        { role: "user", content: [{ ...result, is_error: true }] },
      ],
    })

    expect((await post(relay, { body: reshaped })).status).toBe(200)

    expect(relay.unrestored).toBe(QUERIED_TURN_MISMATCH)
    expect(relay.failure).toBeNull()
    expect(peer.calls).toHaveLength(1)
    expect(JSON.parse(peer.calls[0]?.body.toString() ?? "").messages[1].content[0].is_error).toBe(
      true,
    )
  })
})

describe("the first answer", () => {
  it.each([429, 401, 400, 500, 529])("keeps status %d and its error message", async (status) => {
    const message = "prompt is too long: 213000 tokens > 200000 maximum"
    const body = anthropicError(message)
    const peer = await harness.httpPeer((_, response) =>
      replyStatus(response, status, body, {
        "Content-Type": "application/json",
        "Request-Id": "req_fixture",
      }),
    )
    const relay = await harness.relay(peer.url)

    const answer = await post(relay)

    expect(answer.status).toBe(status)
    expect(answer.body.toString()).toBe(body)
    expect(answer.headers["request-id"]).toBe("req_fixture")
    expect(relay.status).toBe(status)
    expect(relay.requestId).toBe("req_fixture")
    expect(relay.errorText()).toBe(message)
    expect(relay.failure).toBeNull()
    expect(relay.capture.message).toBeNull()

    expect((await post(relay)).status).toBe(400)
    expect(relay.status).toBe(status)
    expect(relay.errorText()).toBe(message)
  })

  it.each([
    ["plain text", "not JSON"],
    ["JSON with no error", "[]"],
    ["a non-text message", '{"error":{"message":12}}'],
    ["an error that is text", '{"error":"nope"}'],
  ])("returns the raw body for %s", async (_label, body) => {
    const peer = await harness.httpPeer((_, response) => replyStatus(response, 500, body))
    const relay = await harness.relay(peer.url)
    await post(relay)
    expect(relay.errorText()).toBe(body)
  })

  it("is empty with no answer and for a 200", async () => {
    const peer = await harness.httpPeer((_, response) => replyStream(response))
    const relay = await harness.relay(peer.url)
    expect(relay.errorText()).toBe("")
    await post(relay)
    expect(relay.errorText()).toBe("")
  })

  it("bounds the stored error body but forwards all of it", async () => {
    const body = "x".repeat(200_000)
    const peer = await harness.httpPeer((_, response) => replyStatus(response, 400, body))
    const relay = await harness.relay(peer.url)

    const answer = await post(relay)

    expect(answer.body.toString()).toBe(body)
    expect(relay.errorText()).toBe(body.slice(0, 65_536))
    expect(relay.failure).toBeNull()
  })

  it.each([
    ["30", 30_000],
    ["1", 1_000],
  ])("reads retry-after %j as %i ms", async (header, expected) => {
    const peer = await harness.httpPeer((_, response) =>
      replyStatus(response, 429, anthropicError("slow down"), { "Retry-After": header }),
    )
    const relay = await harness.relay(peer.url)
    await post(relay)
    expect(relay.retryAfterMs).toBe(expected)
  })

  it("reads a retry-after date as the time left", async () => {
    const date = new Date(Date.now() + 60_000).toUTCString()
    const peer = await harness.httpPeer((_, response) =>
      replyStatus(response, 429, anthropicError("slow down"), { "Retry-After": date }),
    )
    const relay = await harness.relay(peer.url)
    await post(relay)
    expect(relay.retryAfterMs).toBeGreaterThan(50_000)
    expect(relay.retryAfterMs).toBeLessThanOrEqual(60_000)
  })

  it.each([
    ["none", {}],
    ["junk", { "Retry-After": "later" }],
  ])("has no retry delay with %s", async (_name, headers) => {
    const peer = await harness.httpPeer((_, response) =>
      replyStatus(response, 429, anthropicError("slow down"), headers),
    )
    const relay = await harness.relay(peer.url)
    await post(relay)
    expect(relay.retryAfterMs).toBeNull()
  })

  it("has no retry delay before an answer", async () => {
    const peer = await harness.httpPeer((_, response) => replyStream(response))
    const relay = await harness.relay(peer.url)
    expect(relay.retryAfterMs).toBeNull()
  })

  it("prefers request-id over x-request-id", async () => {
    const peer = await harness.httpPeer((_, response) =>
      replyStatus(response, 500, "", { "Request-Id": "req_first", "X-Request-Id": "req_second" }),
    )
    const relay = await harness.relay(peer.url)
    await post(relay)
    expect(relay.requestId).toBe("req_first")
  })

  it("reads x-request-id when it is the only one", async () => {
    const peer = await harness.httpPeer((_, response) =>
      replyStatus(response, 500, "", { "X-Request-Id": "req_second" }),
    )
    const relay = await harness.relay(peer.url)
    await post(relay)
    expect(relay.requestId).toBe("req_second")
  })

  it("forwards response fields except the ones this hop owns", async () => {
    const peer = await harness.httpPeer((_, response) => {
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        Server: "fixture-server",
        "Set-Cookie": ["a=1", "b=2"],
        "X-Fixture": "kept",
      })
      response.end(completeStream())
    })
    const relay = await harness.relay(peer.url)

    const answer = await post(relay)

    expect(answer.headers["set-cookie"]).toEqual(["a=1", "b=2"])
    expect(answer.headers["x-fixture"]).toBe("kept")
    expect(answer.headers.server).toBeUndefined()
    expect(answer.headers.connection).toBe("close")
  })

  it("keeps the upstream's reason phrase", async () => {
    const peer = await harness.httpPeer((_, response) => {
      response.statusMessage = "Overloaded"
      response.statusCode = 529
      response.end()
    })
    const relay = await harness.relay(peer.url)
    const { request, response } = openClient(relay)
    request.end("{}")
    expect((await response).statusMessage).toBe("Overloaded")
  })
})

describe("a stream cut short", () => {
  const partial = [
    MESSAGE_START,
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "partial" } },
  ]
    .map(sseFrame)
    .join("")

  async function rawHttpPeer(finish: "fin" | "reset") {
    return harness.socketPeer((socket) => {
      socket.once("data", () => {
        socket.write(
          `HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nRequest-Id: req_partial\r\n\r\n${partial}`,
          () => {
            if (finish === "fin") socket.end()
            else setTimeout(() => socket.resetAndDestroy(), 50)
          },
        )
      })
    })
  }

  it("keeps a clean end of file as an incomplete capture with no failure", async () => {
    const peer = await rawHttpPeer("fin")
    const relay = await harness.relay(peer.url)

    const answer = await post(relay)

    expect(answer.status).toBe(200)
    expect(answer.body.toString()).toBe(partial)
    expect(relay.status).toBe(200)
    expect(relay.requestId).toBe("req_partial")
    expect(relay.capture.complete).toBe(false)
    expect(relay.capture.message?.content).toEqual([{ type: "text", text: "partial" }])
    expect(relay.failure).toBeNull()
    expect((await post(relay)).status).toBe(400)
  })

  it("names a reset and breaks the client's connection", async () => {
    const peer = await rawHttpPeer("reset")
    const relay = await harness.relay(peer.url)

    const answer = await post(relay)

    expect(answer.status).toBe(200)
    expect(answer.broken).toBe(true)
    expect(relay.capture.complete).toBe(false)
    expect(relay.failure).toBe("ECONNRESET")
    expect(relay.status).toBe(200)
  })

  it("reports a refused connection with no status", async () => {
    const peer = await harness.socketPeer((socket) => socket.destroy())
    const relay = await harness.relay(peer.url)

    const answer = await post(relay)

    expect(answer.status).toBeNull()
    expect(answer.broken).toBe(true)
    expect(relay.status).toBeNull()
    expect(relay.requestId).toBeNull()
    expect(relay.failure).not.toBeNull()
  })

  it("ends the stream when the capture cannot parse it", async () => {
    const peer = await harness.httpPeer((_, response) => replyStream(response, "data: {oops\n\n"))
    const relay = await harness.relay(peer.url)

    const answer = await post(relay)

    expect(answer.broken).toBe(true)
    expect(relay.failure).toBe("CaptureError")
  })

  it("names an upstream that goes silent after the headers", async () => {
    const peer = await harness.httpPeer(async (_, response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" })
      response.write(sseFrame(MESSAGE_START))
      await neverEnds()
    })
    const relay = await harness.relay(peer.url, { timeoutMs: 100 })

    const answer = await post(relay)

    expect(answer.broken).toBe(true)
    expect(relay.failure).toBe("UpstreamIdle")
    expect(relay.status).toBe(200)
  })

  it("names an upstream that sends no headers", async () => {
    const peer = await harness.httpPeer(() => neverEnds())
    const relay = await harness.relay(peer.url, { timeoutMs: 100 })

    const answer = await post(relay)

    expect(answer.broken).toBe(true)
    expect(answer.status).toBeNull()
    expect(relay.failure).toBe("UpstreamTimeout")
    expect(relay.status).toBeNull()
  })

  it("names a body stall on a rejection and keeps its status", async () => {
    const peer = await harness.httpPeer(async (_, response) => {
      response.writeHead(400, { "Request-Id": "req_fixture", "Content-Length": "100" })
      response.flushHeaders()
      await neverEnds()
    })
    const relay = await harness.relay(peer.url, { timeoutMs: 100 })

    await post(relay)

    expect(relay.failure).toBe("UpstreamIdle")
    expect(relay.status).toBe(400)
    expect(relay.requestId).toBe("req_fixture")
  })

  it("lets bytes inside the idle limit keep a slow stream alive", async () => {
    const peer = await harness.httpPeer(async (_, response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" })
      response.write(sseFrame(MESSAGE_START))
      for (let ping = 0; ping < 6; ping += 1) {
        await new Promise((resolve) => setTimeout(resolve, 60))
        response.write(sseFrame({ type: "ping" }))
      }
      response.end(completeStream())
    })
    const relay = await harness.relay(peer.url, { timeoutMs: 150 })

    const answer = await post(relay)

    expect(answer.broken).toBe(false)
    expect(relay.failure).toBeNull()
    expect(relay.capture.complete).toBe(true)
  })
})

describe("abort", () => {
  it("closes the upstream socket while it waits for headers", async () => {
    const peer = await harness.httpPeer(() => neverEnds())
    const relay = await harness.relay(peer.url)
    const answer = post(relay)
    await vi.waitFor(() => expect(peer.calls).toHaveLength(1))

    const upstreamClosed = closed(peer.calls[0]?.socket as never)
    relay.abort()
    await upstreamClosed

    expect((await answer).broken).toBe(true)
    await vi.waitFor(() => expect(relay.failure).toBe("RelayAborted"))
  })

  it("closes the upstream socket in the middle of a stream", async () => {
    const peer = await harness.httpPeer(async (_, response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" })
      response.write(sseFrame(MESSAGE_START))
      await neverEnds()
    })
    const relay = await harness.relay(peer.url)
    const { request, response } = openClient(relay)
    request.end("{}")
    const answer = await response
    answer.on("error", () => {})
    await once(answer, "data")

    const upstreamClosed = closed(peer.calls[0]?.socket as never)
    relay.abort()
    await upstreamClosed

    await vi.waitFor(() => expect(answer.destroyed).toBe(true))
    expect(relay.failure).toBe("RelayAborted")
  })

  it("closes an idle client connection and refuses new ones", async () => {
    const peer = await harness.httpPeer((_, response) => replyStream(response))
    const relay = await harness.relay(peer.url)
    const { request } = openClient(relay, { headers: { "Content-Length": "100" } })
    request.write("{")
    await vi.waitFor(() => expect(relay.used).toBe(true))

    relay.abort()
    relay.abort()

    const next = await post(relay)
    expect(next.broken).toBe(true)
    expect(next.status).toBeNull()
    expect(peer.calls).toHaveLength(0)
    expect(relay.failure).toBe("RelayAborted")
  })

  it("reports no failure once the stream has finished", async () => {
    const peer = await harness.httpPeer((_, response) => replyStream(response))
    const relay = await harness.relay(peer.url)
    await post(relay)

    relay.abort()

    expect(relay.failure).toBeNull()
    expect(relay.capture.complete).toBe(true)
  })

  it("does not change a complete answer when the stream fails after it", async () => {
    const peer = await harness.httpPeer(async (_, response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" })
      response.write(completeStream())
      await neverEnds()
    })
    const relay = await harness.relay(peer.url)
    const { request, response } = openClient(relay)
    request.end("{}")
    const answer = await response
    answer.on("error", () => {})
    answer.resume()
    await vi.waitFor(() => expect(relay.capture.complete).toBe(true))

    relay.abort()
    await closed(peer.calls[0]?.socket as never)

    expect(relay.failure).toBeNull()
  })

  it("stops listening on close, and closing twice is safe", async () => {
    const peer = await harness.httpPeer(() => neverEnds())
    const relay = await harness.relay(peer.url)
    const answer = post(relay)
    await vi.waitFor(() => expect(peer.calls).toHaveLength(1))

    await Promise.all([relay.close(), relay.close()])
    await relay.close()

    expect(relay.failure).toBe("RelayAborted")
    expect((await answer).broken).toBe(true)
    await expect(fetch(relay.url, { method: "POST" })).rejects.toThrow()
  })
})
