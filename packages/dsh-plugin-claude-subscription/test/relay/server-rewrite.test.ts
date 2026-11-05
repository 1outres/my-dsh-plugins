import { gunzipSync } from "node:zlib"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { NativeBlock } from "../../src/contract"
import { post, RelayHarness, replyStatus } from "../support/relay-peers"

const rewrites = vi.hoisted(() => {
  class QueriedTurnMismatch extends Error {}
  const state = {
    restoreError: null as Error | null,
    queriedSeen: [] as unknown[],
  }
  const mark = (payload: Buffer, name: string) => Buffer.concat([payload, Buffer.from(` ${name}`)])
  return {
    state,
    QueriedTurnMismatch,
    module: {
      QueriedTurnMismatch,
      dropMessageBreakpoints: (payload: Buffer) => mark(payload, "drop"),
      restoreQueriedTurn: (payload: Buffer, queried: unknown) => {
        state.queriedSeen.push(queried)
        if (state.restoreError !== null) throw state.restoreError
        return mark(payload, "restore")
      },
      stableRequestContext: (payload: Buffer, queried: unknown) => {
        state.queriedSeen.push(queried)
        return mark(payload, "stable")
      },
      pinMessageBreakpoint: (payload: Buffer, queried: unknown) => {
        state.queriedSeen.push(queried)
        return mark(payload, "pin")
      },
      streamToolInput: (payload: Buffer) => mark(payload, "stream"),
    },
  }
})

vi.mock("../../src/relay/rewrite", () => rewrites.module)

const harness = new RelayHarness()
const QUERIED: NativeBlock[] = [{ type: "text", text: "fixture" }]

beforeEach(() => {
  rewrites.state.restoreError = null
  rewrites.state.queriedSeen = []
})

afterEach(() => harness.dispose())

async function peerAndRelay(options = {}, policy = {}) {
  const peer = await harness.httpPeer((_, response) => replyStatus(response, 200))
  const relay = await harness.relay(peer.url, { queried: QUERIED, ...options }, policy)
  return { peer, relay }
}

describe("the rewrite order", () => {
  it("runs every rewrite in order, starting with the drop on a one-shot call", async () => {
    const { peer, relay } = await peerAndRelay({ oneShot: true })

    await post(relay, { body: "{}" })

    expect(peer.calls[0]?.body.toString()).toBe("{} drop restore stable pin stream")
    expect(rewrites.state.queriedSeen).toEqual([QUERIED, QUERIED, QUERIED])
    expect(relay.unrestored).toBeNull()
  })

  it("keeps the breakpoints on an ordinary call", async () => {
    const { peer, relay } = await peerAndRelay()

    await post(relay, { body: "{}" })

    expect(peer.calls[0]?.body.toString()).toBe("{} restore stable pin stream")
  })

  it("records a mismatch and forwards the frame as the CLI built it", async () => {
    rewrites.state.restoreError = new rewrites.QueriedTurnMismatch("the tail did not match")
    const { peer, relay } = await peerAndRelay()

    const answer = await post(relay, { body: "{}" })

    expect(answer.status).toBe(200)
    expect(relay.unrestored).toBe("the tail did not match")
    expect(relay.failure).toBeNull()
    expect(peer.calls[0]?.body.toString()).toBe("{} stable pin stream")
  })

  it("does not contact the upstream when a rewrite has a bug", async () => {
    rewrites.state.restoreError = new TypeError("private payload text")
    const { peer, relay } = await peerAndRelay()

    const answer = await post(relay, { body: "{}" })

    expect(answer.broken).toBe(true)
    expect(relay.failure).toBe("TypeError")
    expect(relay.unrestored).toBeNull()
    expect(peer.calls).toHaveLength(0)
  })

  it("compresses the bytes that come out of the rewrites", async () => {
    const peer = await harness.httpPeer((_, response) => replyStatus(response, 200))
    const relay = await harness.relay(peer.url, { queried: QUERIED }, { gzipOrigins: [peer.url] })
    const payload = "x".repeat(5_000)

    await post(relay, { body: payload })

    const decoded = gunzipSync(peer.calls[0]?.body as Buffer).toString()
    expect(decoded.startsWith(`${payload} restore stable pin stream\n`)).toBe(true)
  })
})
