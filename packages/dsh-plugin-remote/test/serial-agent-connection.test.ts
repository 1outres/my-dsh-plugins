import { afterEach, describe, expect, it } from "vitest"
import { SerialAgentError, type SerialDataEvent } from "../src/host/serial/agent-connection"
import { SERIAL_CLOSE } from "../src/host/serial/protocol"
import {
  type ConnectAgentResult,
  connectAgent,
  makeAgent,
  waitForCloseWithReason,
} from "./serial/helpers"

const open: ConnectAgentResult[] = []

afterEach(async () => {
  while (open.length > 0) {
    const rig = open.pop()
    if (rig === undefined) continue
    rig.connection.close(1000, "test done")
    await rig.pair.close()
  }
})

async function rig(requestTimeoutMs = 500): Promise<ConnectAgentResult> {
  const connection = await connectAgent({ attach: () => {} }, makeAgent(), requestTimeoutMs)
  open.push(connection)
  return connection
}

describe("AgentConnection", () => {
  it("sends a request and parses its typed result", async () => {
    const { connection, fake } = await rig()
    fake.respond((request) => {
      if (request.method !== "ports.list") return undefined
      return {
        result: {
          ports: [
            {
              path: "/dev/ttyUSB0",
              open: false,
            },
          ],
        },
      }
    })
    const result = await connection.request("ports.list", {})
    expect(result.ports).toEqual([{ path: "/dev/ttyUSB0", open: false }])
    expect(fake.request("ports.list")?.params).toEqual({})
  })

  it("maps an agent error to SerialAgentError with its code", async () => {
    const { connection, fake } = await rig()
    fake.respond(() => ({ error: { code: "busy", message: "The device is held" } }))
    await expect(connection.request("ports.list", {})).rejects.toMatchObject({
      name: "SerialAgentError",
      code: "busy",
      message: "The device is held",
    })
  })

  it("fails a request that the agent never answers", async () => {
    const { connection } = await rig(40)
    const error = await connection.request("ports.list", {}).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(SerialAgentError)
    expect((error as SerialAgentError).code).toBe("timeout")
  })

  it("rejects pending requests when the socket closes", async () => {
    const { connection } = await rig()
    const pending = connection.request("ports.list", {}).catch((value: unknown) => value)
    connection.close(1000, "bye")
    const error = await pending
    expect(error).toBeInstanceOf(SerialAgentError)
    expect((error as SerialAgentError).code).toBe("connection-closed")
  })

  it("closes 4400 when a result does not match the method", async () => {
    const { connection, fake, pair } = await rig()
    const closed = waitForCloseWithReason(pair.client)
    fake.respond(() => ({ result: {} }))
    const error = await connection.request("ports.list", {}).catch((value: unknown) => value)
    expect((error as SerialAgentError).code).toBe("protocol")
    expect((await closed).code).toBe(SERIAL_CLOSE.protocol)
  })

  it("decodes data events and reports closed events", async () => {
    const { connection, fake } = await rig()
    const data: SerialDataEvent[] = []
    const closed: string[] = []
    connection.onData((event) => data.push(event))
    connection.onPortClosed((event) => closed.push(event.reason))
    fake.sendData("p1", 4, Buffer.from("hello"))
    fake.sendClosed("p1", "device-removed", "The cable was pulled")
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(data).toEqual([{ handle: "p1", offset: 4, data: Buffer.from("hello") }])
    expect(closed).toEqual(["device-removed"])
  })

  it("aborts a pending request with the signal reason", async () => {
    const { connection } = await rig()
    const controller = new AbortController()
    const pending = connection
      .request("ports.list", {}, controller.signal)
      .catch((value: unknown) => value)
    controller.abort(new Error("cancelled by the model"))
    const error = await pending
    expect((error as Error).message).toBe("cancelled by the model")
  })
})
