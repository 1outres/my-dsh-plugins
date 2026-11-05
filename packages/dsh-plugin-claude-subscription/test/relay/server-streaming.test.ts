import { once } from "node:events"
import type { ServerResponse } from "node:http"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  closed,
  completeStream,
  MESSAGE_START,
  neverEnds,
  openClient,
  type Peer,
  RelayHarness,
  sseFrame,
} from "../support/relay-peers"

const harness = new RelayHarness()

afterEach(() => harness.dispose())

const PING = Buffer.from(sseFrame({ type: "ping", pad: "x".repeat(65_536) }))
/** More than what the kernel buffers on loopback sockets can hold between the three hops. */
const STREAM_BYTES = 128 * 1024 * 1024

interface Pump {
  /** Bytes that the upstream socket has accepted. */
  accepted: number
  done: boolean
}

async function pumpPings(response: ServerResponse, pump: Pump, totalBytes: number): Promise<void> {
  response.writeHead(200, { "Content-Type": "text/event-stream" })
  response.write(sseFrame(MESSAGE_START))
  while (pump.accepted < totalBytes && !response.destroyed) {
    if (!response.write(PING)) await once(response, "drain").catch(() => {})
    pump.accepted += PING.length
  }
  if (!response.destroyed) response.end(completeStream())
  pump.done = true
}

async function pumpingPeer(pump: Pump, totalBytes = STREAM_BYTES): Promise<Peer> {
  return harness.httpPeer((_, response) => pumpPings(response, pump, totalBytes))
}

async function untilSteady(read: () => number): Promise<number> {
  let last = -1
  for (;;) {
    const now = read()
    if (now === last && now > 0) return now
    last = now
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
}

describe("streaming", () => {
  it("sends the headers before the upstream sends any body", async () => {
    const peer = await harness.httpPeer(async (_, response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream", "X-Fixture": "early" })
      response.flushHeaders()
      await neverEnds()
    })
    const relay = await harness.relay(peer.url)
    const { request, response } = openClient(relay)
    request.end("{}")

    const answer = await response

    expect(answer.statusCode).toBe(200)
    expect(answer.headers["x-fixture"]).toBe("early")
  })

  it("delivers each chunk before the upstream finishes", async () => {
    let release = () => {}
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = sseFrame(MESSAGE_START)
    const rest = completeStream().slice(first.length)
    const peer = await harness.httpPeer(async (_, response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" })
      response.write(first)
      await released
      response.end(rest)
    })
    const relay = await harness.relay(peer.url)
    const { request, response } = openClient(relay)
    request.end("{}")

    const answer = await response
    const [chunk] = (await once(answer, "data")) as [Buffer]
    expect(chunk.toString()).toBe(first)
    expect(relay.capture.complete).toBe(false)

    release()
    const chunks: Buffer[] = []
    for await (const piece of answer) chunks.push(piece as Buffer)

    expect(Buffer.concat(chunks).toString()).toBe(rest)
    expect(relay.capture.complete).toBe(true)
    expect(relay.capture.message?.id).toBe("first")
    expect(peer.calls).toHaveLength(1)
    expect(relay.failure).toBeNull()
  })

  it("stops reading the upstream while the client does not read", { timeout: 60_000 }, async () => {
    const pump: Pump = { accepted: 0, done: false }
    const peer = await pumpingPeer(pump)
    const relay = await harness.relay(peer.url, { timeoutMs: 30_000 })
    const { request, response } = openClient(relay)
    request.end("{}")
    const answer = await response
    answer.pause()

    const heldBack = await untilSteady(() => pump.accepted)

    expect(pump.done).toBe(false)
    expect(heldBack).toBeLessThan(STREAM_BYTES)

    let received = 0
    for await (const chunk of answer) received += (chunk as Buffer).length

    expect(received).toBeGreaterThanOrEqual(STREAM_BYTES)
    expect(pump.done).toBe(true)
    expect(relay.capture.complete).toBe(true)
    expect(relay.failure).toBeNull()
  })

  it("fails a stalled client and not the quiet upstream", { timeout: 60_000 }, async () => {
    const pump: Pump = { accepted: 0, done: false }
    const peer = await pumpingPeer(pump)
    const relay = await harness.relay(peer.url, { timeoutMs: 500 })
    const { request, response } = openClient(relay)
    request.end("{}")
    const answer = await response
    answer.on("error", () => {})
    answer.pause()

    await vi.waitFor(() => expect(relay.failure).toBe("ClientStalled"), { timeout: 30_000 })

    await closed(peer.calls[0]?.socket as never)
  })

  it("keeps the idle limit off while it waits for a slow client", { timeout: 60_000 }, async () => {
    const pump: Pump = { accepted: 0, done: false }
    const peer = await pumpingPeer(pump)
    const relay = await harness.relay(peer.url, { timeoutMs: 1_000 })
    const { request, response } = openClient(relay)
    request.end("{}")
    const answer = await response
    answer.pause()
    await untilSteady(() => pump.accepted)

    let received = 0
    for await (const chunk of answer) received += (chunk as Buffer).length

    expect(received).toBeGreaterThanOrEqual(STREAM_BYTES)
    expect(relay.failure).toBeNull()
  })
})
