import { once } from "node:events"
import { connect } from "node:net"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  closed,
  completeStream,
  MESSAGE_START,
  neverEnds,
  openClient,
  type Peer,
  post,
  RelayHarness,
  replyStream,
  sseFrame,
} from "../support/relay-peers"

const harness = new RelayHarness()
const hostFailures: unknown[] = []
const recordHostFailure = (error: unknown) => hostFailures.push(error)

beforeEach(() => {
  hostFailures.length = 0
  process.on("uncaughtException", recordHostFailure)
  process.on("unhandledRejection", recordHostFailure)
})

afterEach(async () => {
  await harness.dispose()
  await new Promise((resolve) => setTimeout(resolve, 20))
  process.off("uncaughtException", recordHostFailure)
  process.off("unhandledRejection", recordHostFailure)
  expect(hostFailures).toEqual([])
})

function streamOneFrameThenWait(): Promise<Peer> {
  return harness.httpPeer(async (_, response) => {
    response.writeHead(200, { "Content-Type": "text/event-stream" })
    response.write(sseFrame(MESSAGE_START))
    await neverEnds()
  })
}

/** Writes until the socket closes, so the relay keeps writing to a client that left. */
function streamForever(): Promise<Peer> {
  const frame = sseFrame({ type: "ping", pad: "x".repeat(16_384) })
  return harness.httpPeer(async (_, response) => {
    response.writeHead(200, { "Content-Type": "text/event-stream" })
    response.write(sseFrame(MESSAGE_START))
    while (!response.destroyed) {
      if (!response.write(frame)) await once(response, "drain").catch(() => {})
      await new Promise((resolve) => setImmediate(resolve))
    }
  })
}

async function resetProbe(relayUrl: string, path: string): Promise<void> {
  const url = new URL(relayUrl)
  const socket = connect(Number(url.port), url.hostname)
  socket.on("error", () => {})
  await once(socket, "connect")
  socket.write(`GET ${path} HTTP/1.1\r\nHost: relay\r\n\r\n`)
  socket.resetAndDestroy()
  await new Promise((resolve) => setTimeout(resolve, 50))
}

describe("a client that hangs up", () => {
  it("survives a probe that resets before it reads, and still serves the real request", async () => {
    const stderr = vi.spyOn(process.stderr, "write")
    const peer = await harness.httpPeer((_, response) => replyStream(response))
    const relay = await harness.relay(peer.url)

    await resetProbe(relay.url, `${new URL(relay.url).pathname}/api/hello`)

    expect(stderr).not.toHaveBeenCalled()
    stderr.mockRestore()
    expect(relay.used).toBe(false)
    expect(relay.failure).toBeNull()
    expect((await post(relay)).status).toBe(200)
    expect(relay.capture.complete).toBe(true)
  })

  it("survives a reset on a denied request", async () => {
    const peer = await harness.httpPeer((_, response) => replyStream(response))
    const relay = await harness.relay(peer.url)
    await post(relay)
    const url = new URL(relay.url)
    const socket = connect(Number(url.port), url.hostname)
    socket.on("error", () => {})
    await once(socket, "connect")
    socket.write(
      `POST ${url.pathname}/v1/messages HTTP/1.1\r\nHost: relay\r\nContent-Length: 2\r\n\r\n{}`,
    )
    socket.resetAndDestroy()

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect((await post(relay)).status).toBe(400)
    expect(peer.calls).toHaveLength(1)
  })

  it("closes the upstream when the client leaves in the middle of a stream", async () => {
    const peer = await streamOneFrameThenWait()
    const relay = await harness.relay(peer.url)
    const { request, response } = openClient(relay)
    request.end("{}")
    const answer = await response
    answer.on("error", () => {})
    await once(answer, "data")

    const upstreamClosed = closed(peer.calls[0]?.socket as never)
    request.destroy()
    await upstreamClosed

    await vi.waitFor(() => expect(relay.failure).toBe("ClientDisconnected"))
    expect((await post(relay)).status).toBe(400)
    expect(peer.calls).toHaveLength(1)
  })

  it("closes the upstream when the client leaves while it waits for headers", async () => {
    const peer = await harness.httpPeer(() => neverEnds())
    const relay = await harness.relay(peer.url)
    const { request } = openClient(relay)
    request.end("{}")
    await vi.waitFor(() => expect(peer.calls).toHaveLength(1))

    const upstreamClosed = closed(peer.calls[0]?.socket as never)
    request.destroy()
    await upstreamClosed

    await vi.waitFor(() => expect(relay.failure).toBe("ClientDisconnected"))
  })

  it("survives a reset while the upstream keeps writing", async () => {
    const peer = await streamForever()
    const relay = await harness.relay(peer.url)
    const { request, response } = openClient(relay)
    request.end("{}")
    const answer = await response
    answer.on("error", () => {})
    await once(answer, "data")

    const upstreamClosed = closed(peer.calls[0]?.socket as never)
    request.socket?.resetAndDestroy()
    await upstreamClosed

    await vi.waitFor(() => expect(relay.failure).toBe("ClientDisconnected"))
  })

  it("reports no failure when the client leaves after a complete answer", async () => {
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

    const upstreamClosed = closed(peer.calls[0]?.socket as never)
    request.destroy()
    await upstreamClosed

    expect(relay.failure).toBeNull()
    expect(relay.status).toBe(200)
  })

  it("survives garbage that is not HTTP", async () => {
    const peer = await harness.httpPeer((_, response) => replyStream(response))
    const relay = await harness.relay(peer.url)
    const url = new URL(relay.url)
    const socket = connect(Number(url.port), url.hostname)
    socket.on("error", () => {})
    await once(socket, "connect")
    socket.write("\x16\x03\x01 not http\r\n\r\n")
    await once(socket, "close")

    expect((await post(relay)).status).toBe(200)
  })
})
