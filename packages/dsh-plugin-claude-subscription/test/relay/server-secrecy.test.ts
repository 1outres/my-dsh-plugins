import { inspect } from "node:util"
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest"
import type { Relay } from "../../src/contract"
import {
  closed,
  neverEnds,
  post,
  RelayHarness,
  replyStatus,
  replyStream,
} from "../support/relay-peers"

const TOKEN = "fixture-private-token"
const AUTHORIZATION = { Authorization: `Bearer ${TOKEN}` }

const harness = new RelayHarness()
let outputs: MockInstance[] = []

beforeEach(() => {
  outputs = [
    vi.spyOn(process.stdout, "write"),
    vi.spyOn(process.stderr, "write"),
    ...(["log", "info", "warn", "error", "debug", "trace"] as const).map((method) =>
      vi.spyOn(console, method),
    ),
  ]
})

afterEach(async () => {
  await harness.dispose()
  vi.restoreAllMocks()
})

function routeOf(relay: Relay): string {
  return new URL(relay.url).pathname
}

function expectNothingLeaked(relay: Relay): void {
  const route = routeOf(relay)
  const printed = outputs.flatMap((output) => output.mock.calls.map((call) => inspect(call)))
  const reported = [
    relay.failure,
    relay.errorText(),
    relay.unrestored,
    relay.requestId,
    inspect(relay, { showHidden: true, depth: 8 }),
    JSON.stringify(relay),
    ...printed,
  ].join("\n")
  expect(reported).not.toContain(TOKEN)
  expect(reported).not.toContain(route)
  expect(reported.toLowerCase()).not.toContain("authorization")
}

describe("secrecy", () => {
  it("keeps the header and the route out of a successful call", async () => {
    const peer = await harness.httpPeer((_, response) => replyStream(response))
    const relay = await harness.relay(peer.url)

    const answer = await post(relay, { headers: AUTHORIZATION })

    expect(peer.calls[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`)
    expect(peer.calls[0]?.url).toBe("/v1/messages")
    expect(JSON.stringify(answer.headers)).not.toContain(routeOf(relay))
    expectNothingLeaked(relay)
  })

  it("keeps them out of an upstream rejection and a denial", async () => {
    const peer = await harness.httpPeer((_, response) =>
      replyStatus(response, 401, '{"error":{"message":"invalid credential"}}'),
    )
    const relay = await harness.relay(peer.url)

    await post(relay, { headers: AUTHORIZATION })
    const denied = await post(relay, { headers: AUTHORIZATION })

    expect(denied.body.toString()).not.toContain(routeOf(relay))
    expect(relay.errorText()).toBe("invalid credential")
    expectNothingLeaked(relay)
  })

  it("keeps them out of responses to unknown routes", async () => {
    const peer = await harness.httpPeer((_, response) => replyStream(response))
    const relay = await harness.relay(peer.url)

    const notFound = await post(relay, { path: "/nope", headers: AUTHORIZATION })
    const probe = await post(relay, { method: "GET", path: "/nope", headers: AUTHORIZATION })

    expect(notFound.body.length).toBe(0)
    expect(probe.body.length).toBe(0)
    expectNothingLeaked(relay)
  })

  it("keeps them out of a failed connection", async () => {
    const peer = await harness.socketPeer((socket) => socket.destroy())
    const relay = await harness.relay(peer.url)

    await post(relay, { headers: AUTHORIZATION })

    expect(relay.failure).not.toBeNull()
    expect(relay.failure).toMatch(/^\w+$/)
    expectNothingLeaked(relay)
  })

  it("rejects a bad header value without quoting it", async () => {
    const peer = await harness.httpPeer((_, response) => replyStream(response))
    const relay = await harness.relay(peer.url)
    const url = new URL(relay.url)
    const { connect } = await import("node:net")
    const socket = connect(Number(url.port), url.hostname)
    socket.on("error", () => {})
    socket.write(
      `POST ${url.pathname}/v1/messages HTTP/1.1\r\nHost: relay\r\nContent-Length: 2\r\nAuthorization: Bearer ${TOKEN}\x7f\r\n\r\n{}`,
    )
    await closed(socket)

    expectNothingLeaked(relay)
  })

  it("keeps them out of an abort", async () => {
    const peer = await harness.httpPeer(() => neverEnds())
    const relay = await harness.relay(peer.url)
    const answer = post(relay, { headers: AUTHORIZATION })
    await vi.waitFor(() => expect(peer.calls).toHaveLength(1))

    relay.abort()
    await answer

    expect(relay.failure).toBe("RelayAborted")
    expectNothingLeaked(relay)
  })
})
