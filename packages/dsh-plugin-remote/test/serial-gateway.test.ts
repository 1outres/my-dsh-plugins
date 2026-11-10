import { once } from "node:events"
import type { IncomingMessage } from "node:http"
import { afterEach, describe, expect, it } from "vitest"
import WebSocket from "ws"
import { SerialAgents } from "../src/host/serial/agents"
import { SerialGateway, type SerialGatewayOptions } from "../src/host/serial/gateway"
import {
  type ChallengeFrame,
  encodeFrame,
  parseServerFrame,
  SERIAL_CLOSE,
} from "../src/host/serial/protocol"
import {
  authFrame,
  createUpgradeHost,
  makeAgent,
  type TestAgent,
  WsInbox,
  waitFor,
  waitForCloseWithReason,
} from "./serial/helpers"

const cleanups: Array<() => Promise<void> | void> = []
const clients: WebSocket[] = []

afterEach(async () => {
  while (clients.length > 0) clients.pop()?.terminate()
  while (cleanups.length > 0) await cleanups.pop()?.()
})

async function startGateway(options: Partial<SerialGatewayOptions> = {}): Promise<{
  agent: TestAgent
  agents: SerialAgents
  gateway: SerialGateway
  baseUrl: string
}> {
  const agent = makeAgent()
  const agents = new SerialAgents([agent.authorized])
  const upgradeHost = await createUpgradeHost()
  const gateway = new SerialGateway(agents, {
    path: "/remote-serial/agent",
    requestTimeoutMs: 500,
    heartbeatIntervalMs: 60_000,
    heartbeatTimeoutMs: 120_000,
    ...options,
  })
  gateway.attach(upgradeHost.host)
  cleanups.push(async () => {
    gateway.dispose()
    await upgradeHost.close()
  })
  return { agent, agents, gateway, baseUrl: upgradeHost.baseUrl }
}

async function openClient(
  baseUrl: string,
  options: { origin?: string } = {},
): Promise<{ socket: WebSocket; inbox: WsInbox }> {
  const socket =
    options.origin === undefined
      ? new WebSocket(`${baseUrl}/remote-serial/agent`)
      : new WebSocket(`${baseUrl}/remote-serial/agent`, { origin: options.origin })
  clients.push(socket)
  const inbox = new WsInbox(socket)
  await once(socket, "open")
  return { socket, inbox }
}

async function challengeOf(inbox: WsInbox): Promise<ChallengeFrame> {
  const frame = parseServerFrame(await inbox.next())
  if (frame.type !== "challenge") throw new Error(`Expected a challenge, got ${frame.type}`)
  return frame
}

describe("serial gateway handshake", () => {
  it("welcomes an authorized key with a valid signature", async () => {
    const { agent, agents, baseUrl } = await startGateway()
    const { socket, inbox } = await openClient(baseUrl)
    const challenge = await challengeOf(inbox)
    socket.send(encodeFrame(authFrame(agent, challenge.nonce)))
    expect(parseServerFrame(await inbox.next())).toEqual({ type: "welcome", name: "lab-mac" })
    await waitFor(() => agents.online("lab-mac"))
    expect(agents.connection("lab-mac")?.fingerprint).toBe(agent.authorized.key.fingerprint)
  })

  it("rejects an unknown key with 4403", async () => {
    const { baseUrl } = await startGateway()
    const stranger = makeAgent("stranger")
    const { socket, inbox } = await openClient(baseUrl)
    const challenge = await challengeOf(inbox)
    const closed = waitForCloseWithReason(socket)
    socket.send(encodeFrame(authFrame(stranger, challenge.nonce)))
    expect(parseServerFrame(await inbox.next())).toMatchObject({
      type: "rejected",
      code: "unknown-key",
    })
    expect((await closed).code).toBe(SERIAL_CLOSE.unknownKey)
  })

  it("rejects a bad signature with 4401", async () => {
    const { agent, baseUrl } = await startGateway()
    const { socket, inbox } = await openClient(baseUrl)
    const challenge = await challengeOf(inbox)
    const frame = authFrame(agent, challenge.nonce)
    const closed = waitForCloseWithReason(socket)
    socket.send(encodeFrame({ ...frame, signature: Buffer.alloc(64).toString("base64") }))
    expect(parseServerFrame(await inbox.next())).toMatchObject({
      type: "rejected",
      code: "bad-signature",
    })
    expect((await closed).code).toBe(SERIAL_CLOSE.auth)
  })

  it("rejects a different protocol number with 4401", async () => {
    const { agent, baseUrl } = await startGateway()
    const { socket, inbox } = await openClient(baseUrl)
    const challenge = await challengeOf(inbox)
    const closed = waitForCloseWithReason(socket)
    socket.send(encodeFrame(authFrame(agent, challenge.nonce, 2)))
    expect(parseServerFrame(await inbox.next())).toMatchObject({
      type: "rejected",
      code: "protocol",
    })
    expect((await closed).code).toBe(SERIAL_CLOSE.auth)
  })

  it("closes a silent handshake with 4408", async () => {
    const { baseUrl } = await startGateway({ handshakeTimeoutMs: 100 })
    const { socket, inbox } = await openClient(baseUrl)
    await challengeOf(inbox)
    const closed = waitForCloseWithReason(socket)
    expect((await closed).code).toBe(SERIAL_CLOSE.handshakeTimeout)
  })

  it("refuses an upgrade that carries an Origin header", async () => {
    const { baseUrl } = await startGateway()
    const socket = new WebSocket(`${baseUrl}/remote-serial/agent`, {
      origin: "http://evil.example",
    })
    clients.push(socket)
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      socket.once("unexpected-response", (_request, incoming) => resolve(incoming))
      socket.once("error", reject)
    })
    expect(response.statusCode).toBe(403)
    response.destroy()
  })

  it("closes a binary frame during the handshake with 4400", async () => {
    const { baseUrl } = await startGateway()
    const { socket, inbox } = await openClient(baseUrl)
    await challengeOf(inbox)
    const closed = waitForCloseWithReason(socket)
    socket.send(Buffer.from("{}"))
    expect((await closed).code).toBe(SERIAL_CLOSE.protocol)
  })

  it("replaces an older connection for the same key", async () => {
    const { agent, agents, baseUrl } = await startGateway()
    const first = await openClient(baseUrl)
    const firstChallenge = await challengeOf(first.inbox)
    first.socket.send(encodeFrame(authFrame(agent, firstChallenge.nonce)))
    expect(parseServerFrame(await first.inbox.next())).toEqual({ type: "welcome", name: "lab-mac" })
    const firstClosed = waitForCloseWithReason(first.socket)

    const second = await openClient(baseUrl)
    const secondChallenge = await challengeOf(second.inbox)
    second.socket.send(encodeFrame(authFrame(agent, secondChallenge.nonce)))
    expect(parseServerFrame(await second.inbox.next())).toEqual({
      type: "welcome",
      name: "lab-mac",
    })
    expect((await firstClosed).code).toBe(SERIAL_CLOSE.replaced)
    await waitFor(() => agents.online("lab-mac"))
  })

  it("removes the route when the gateway is disposed", async () => {
    const { gateway, baseUrl } = await startGateway()
    gateway.dispose()
    const socket = new WebSocket(`${baseUrl}/remote-serial/agent`)
    clients.push(socket)
    await expect(
      new Promise((_resolve, reject) => {
        socket.once("open", () => reject(new Error("The socket opened")))
        socket.once("error", reject)
      }),
    ).rejects.toThrow()
  })
})
