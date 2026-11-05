import { once } from "node:events"
import { createServer, type IncomingHttpHeaders } from "node:http"
import { type AddressInfo, connect, type Socket } from "node:net"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  closed,
  MESSAGE_START,
  neverEnds,
  type Peer,
  post,
  RelayHarness,
  replyStream,
  sseFrame,
  TEST_CERT,
} from "../support/relay-peers"

const harness = new RelayHarness()
const proxies: (() => Promise<void>)[] = []

afterEach(async () => {
  await harness.dispose()
  await Promise.all(proxies.splice(0).map((stop) => stop()))
  vi.restoreAllMocks()
})

interface ProxyVisit {
  target: string
  headers: IncomingHttpHeaders
  socket: Socket
}

type ProxyBehavior = (visit: ProxyVisit) => void

async function startProxy(behavior: ProxyBehavior) {
  const visits: ProxyVisit[] = []
  const sockets = new Set<Socket>()
  const server = createServer()
  server.on("connection", (socket) => {
    sockets.add(socket)
    socket.on("error", () => {})
  })
  server.on("connect", (request, socket) => {
    const visit = {
      target: request.url ?? "",
      headers: request.headers,
      socket: socket as Socket,
    }
    visits.push(visit)
    behavior(visit)
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  proxies.push(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve) => server.close(resolve))
  })
  return { visits, port: (server.address() as AddressInfo).port }
}

function tunnelTo(peer: Peer): ProxyBehavior {
  return ({ socket }) => {
    const onward = connect(peer.port, "127.0.0.1")
    onward.on("error", () => socket.destroy())
    socket.on("close", () => onward.destroy())
    onward.on("close", () => socket.destroy())
    onward.once("connect", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      socket.pipe(onward)
      onward.pipe(socket)
    })
  }
}

const TRUST_FIXTURE = { tls: { ca: TEST_CERT } }

describe("a direct TLS upstream", () => {
  it("connects with certificate checks on", async () => {
    const peer = await harness.tlsPeer((_, response) => replyStream(response))
    const relay = await harness.relay(peer.url, {}, TRUST_FIXTURE)

    const answer = await post(relay, { headers: { Authorization: "Bearer fixture" } })

    expect(answer.status).toBe(200)
    expect(relay.capture.complete).toBe(true)
    expect(peer.calls[0]?.headers.authorization).toBe("Bearer fixture")
    expect(peer.calls[0]?.headers.host).toBe(`localhost:${peer.port}`)
  })

  it("checks an IP address against the certificate", async () => {
    const peer = await harness.tlsPeer((_, response) => replyStream(response))
    const relay = await harness.relay(`https://127.0.0.1:${peer.port}`, {}, TRUST_FIXTURE)

    expect((await post(relay)).status).toBe(200)
  })

  it("refuses a certificate it does not trust and sends nothing", async () => {
    const peer = await harness.tlsPeer((_, response) => replyStream(response))
    const relay = await harness.relay(peer.url)

    const answer = await post(relay, { headers: { Authorization: "Bearer fixture" } })

    expect(answer.broken).toBe(true)
    expect(relay.failure).toMatch(/SELF_SIGNED|UNABLE_TO_VERIFY/)
    expect(relay.status).toBeNull()
    expect(peer.calls).toHaveLength(0)
  })

  it("names a silent stream over TLS", async () => {
    const peer = await harness.tlsPeer(async (_, response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" })
      response.write(sseFrame(MESSAGE_START))
      await neverEnds()
    })
    const relay = await harness.relay(peer.url, { timeoutMs: 150 }, TRUST_FIXTURE)

    await post(relay)

    expect(relay.failure).toBe("UpstreamIdle")
  })

  it("keeps a slow TLS stream alive", async () => {
    const peer = await harness.tlsPeer(async (_, response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" })
      response.write(sseFrame(MESSAGE_START))
      for (let ping = 0; ping < 5; ping += 1) {
        await new Promise((resolve) => setTimeout(resolve, 80))
        response.write(sseFrame({ type: "ping" }))
      }
      response.end()
    })
    const relay = await harness.relay(peer.url, { timeoutMs: 200 }, TRUST_FIXTURE)

    const answer = await post(relay)

    expect(answer.broken).toBe(false)
    expect(relay.failure).toBeNull()
  })

  it("closes the upstream socket on abort", async () => {
    const peer = await harness.tlsPeer(() => neverEnds())
    const relay = await harness.relay(peer.url, {}, TRUST_FIXTURE)
    const answer = post(relay)
    await vi.waitFor(() => expect(peer.calls).toHaveLength(1))

    const upstreamClosed = closed(peer.calls[0]?.socket as never)
    relay.abort()
    await upstreamClosed

    expect((await answer).broken).toBe(true)
  })

  it("ends a handshake that never finishes when it aborts or times out", async () => {
    const holding: Socket[] = []
    const silent = await harness.socketPeer((socket) => {
      holding.push(socket)
      socket.resume()
    })
    const url = `https://localhost:${silent.port}`

    const aborted = await harness.relay(url, {}, TRUST_FIXTURE)
    const abortedAnswer = post(aborted)
    await vi.waitFor(() => expect(holding).toHaveLength(1))
    const closedOnAbort = closed(holding[0] as Socket)
    aborted.abort()
    await closedOnAbort
    await abortedAnswer
    expect(aborted.failure).toBe("RelayAborted")

    const timed = await harness.relay(url, { timeoutMs: 100 }, TRUST_FIXTURE)
    await post(timed)
    expect(timed.failure).toBe("UpstreamTimeout")
  })
})

describe("a CONNECT proxy", () => {
  it("carries TLS through a tunnel, and the proxy never sees the bearer", async () => {
    const peer = await harness.tlsPeer((_, response) => replyStream(response))
    const proxy = await startProxy(tunnelTo(peer))
    const relay = await harness.relay(
      "https://upstream.test/base",
      { env: { HTTPS_PROXY: `http://user:p%40ss@127.0.0.1:${proxy.port}` } },
      TRUST_FIXTURE,
    )

    const answer = await post(relay, { headers: { Authorization: "Bearer subscription-secret" } })

    expect(answer.status).toBe(200)
    expect(relay.capture.complete).toBe(true)
    expect(relay.failure).toBeNull()
    const [visit] = proxy.visits
    expect(visit?.target).toBe("upstream.test:443")
    expect(visit?.headers.host).toBe("upstream.test:443")
    expect(visit?.headers["proxy-authorization"]).toBe(
      `Basic ${Buffer.from("user:p@ss").toString("base64")}`,
    )
    expect(visit?.headers.authorization).toBeUndefined()
    const [call] = peer.calls
    expect(call?.url).toBe("/base/v1/messages")
    expect(call?.headers.host).toBe("upstream.test")
    expect(call?.headers.authorization).toBe("Bearer subscription-secret")
    expect(call?.headers["proxy-authorization"]).toBeUndefined()
  })

  it("checks the certificate against the upstream name, not the proxy", async () => {
    const peer = await harness.tlsPeer((_, response) => replyStream(response))
    const proxy = await startProxy(tunnelTo(peer))
    const relay = await harness.relay(
      "https://other.test",
      { env: { HTTPS_PROXY: `http://127.0.0.1:${proxy.port}` } },
      TRUST_FIXTURE,
    )

    await post(relay, { headers: { Authorization: "Bearer fixture" } })

    expect(relay.failure).toBe("ERR_TLS_CERT_ALTNAME_INVALID")
    expect(peer.calls).toHaveLength(0)
  })

  it("records a failure when the tunnel has nothing behind it", async () => {
    const proxy = await startProxy(({ socket }) => {
      socket.end("HTTP/1.1 200 Connection Established\r\n\r\n")
    })
    const relay = await harness.relay("https://api.example.invalid/base", {
      env: { HTTPS_PROXY: `http://127.0.0.1:${proxy.port}` },
    })

    const answer = await post(relay, { headers: { Authorization: "Bearer fixture" } })

    expect(proxy.visits[0]?.target).toBe("api.example.invalid:443")
    expect(answer.broken).toBe(true)
    expect(relay.failure).not.toBeNull()
    expect(relay.status).toBeNull()
  })

  it("records a refused tunnel and keeps the proxy's text out", async () => {
    const proxy = await startProxy(({ socket }) => {
      socket.end("HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n")
    })
    const relay = await harness.relay("https://api.example.invalid", {
      env: { HTTPS_PROXY: `http://user:hunter2@127.0.0.1:${proxy.port}` },
    })

    const answer = await post(relay)

    expect(answer.broken).toBe(true)
    expect(relay.failure).toBe("ProxyTunnelRefused")
    expect(relay.status).toBeNull()
    expect(relay.errorText()).toBe("")
  })

  it("closes the proxy connection on abort and on a silent proxy", async () => {
    const proxy = await startProxy(({ socket }) => {
      socket.resume()
      socket.once("end", () => socket.destroy())
    })
    const env = { HTTPS_PROXY: `http://127.0.0.1:${proxy.port}` }

    const relay = await harness.relay("https://api.example.invalid", { env })
    const answer = post(relay)
    await vi.waitFor(() => expect(proxy.visits).toHaveLength(1))
    const proxyClosed = closed(proxy.visits[0]?.socket as Socket)
    relay.abort()
    await proxyClosed
    await answer
    expect(relay.failure).toBe("RelayAborted")

    const timed = await harness.relay("https://api.example.invalid", { env, timeoutMs: 100 })
    await post(timed)
    expect(timed.failure).toBe("UpstreamTimeout")
  })
})

describe("TCP keepalive", () => {
  it("is on for the upstream socket", async () => {
    const { Socket: NetSocket } = await import("node:net")
    const setKeepAlive = vi.spyOn(NetSocket.prototype, "setKeepAlive")
    const peer = await harness.httpPeer((_, response) => replyStream(response))
    const relay = await harness.relay(peer.url)

    await post(relay)

    expect(setKeepAlive).toHaveBeenCalledWith(true, 15_000)
  })
})
