import { describe, expect, it } from "vitest"
import {
  encodeFrame,
  parseAgentFrame,
  parseHandshakeFrame,
  parseServerFrame,
  SERIAL_PROTOCOL_VERSION,
  SerialProtocolError,
  serialMethodSchemas,
} from "../src/host/serial/protocol"

const nonce = Buffer.alloc(32, 7).toString("base64")

describe("serial protocol frames", () => {
  it("parses a challenge", () => {
    const frame = parseServerFrame(
      JSON.stringify({ type: "challenge", protocol: SERIAL_PROTOCOL_VERSION, nonce }),
    )
    expect(frame).toEqual({ type: "challenge", protocol: 1, nonce })
  })

  it("parses an auth frame with agent facts", () => {
    const frame = parseHandshakeFrame(
      JSON.stringify({
        type: "auth",
        protocol: 1,
        publicKey: nonce,
        signature: nonce,
        agent: { version: "0.1.0", hostname: "lab-mac", os: "darwin", arch: "arm64" },
      }),
    )
    expect(frame.agent.hostname).toBe("lab-mac")
  })

  it("parses a response with a result or an error, never both", () => {
    expect(
      parseAgentFrame(JSON.stringify({ type: "response", id: 1, result: { ports: [] } })),
    ).toEqual({ type: "response", id: 1, result: { ports: [] } })
    expect(
      parseAgentFrame(
        JSON.stringify({ type: "response", id: 1, error: { code: "busy", message: "held" } }),
      ),
    ).toEqual({ type: "response", id: 1, error: { code: "busy", message: "held" } })
    expect(() =>
      parseAgentFrame(
        JSON.stringify({
          type: "response",
          id: 1,
          result: {},
          error: { code: "busy", message: "held" },
        }),
      ),
    ).toThrow(SerialProtocolError)
    expect(() => parseAgentFrame(JSON.stringify({ type: "response", id: 1 }))).toThrow(
      SerialProtocolError,
    )
  })

  it("parses data and closed events", () => {
    expect(
      parseAgentFrame(
        JSON.stringify({
          type: "event",
          event: "data",
          handle: "p1",
          offset: 3,
          data: Buffer.from("hi").toString("base64"),
        }),
      ),
    ).toMatchObject({ event: "data", offset: 3 })
    expect(
      parseAgentFrame(
        JSON.stringify({
          type: "event",
          event: "closed",
          handle: "p1",
          reason: "device-removed",
          message: "gone",
        }),
      ),
    ).toMatchObject({ event: "closed", reason: "device-removed" })
    expect(
      parseAgentFrame(
        JSON.stringify({
          type: "event",
          event: "closed",
          handle: "p1",
          reason: "io-error",
        }),
      ),
    ).toMatchObject({ event: "closed", reason: "io-error", message: "" })
  })

  it("rejects malformed frames", () => {
    expect(() => parseServerFrame("not json")).toThrow(SerialProtocolError)
    expect(() => parseServerFrame(JSON.stringify({ type: "other" }))).toThrow(SerialProtocolError)
    expect(() =>
      parseServerFrame(
        JSON.stringify({ type: "request", id: 1, method: "port.explode", params: {} }),
      ),
    ).toThrow(SerialProtocolError)
    expect(() =>
      parseAgentFrame(
        JSON.stringify({ type: "event", event: "data", handle: "p1", offset: -1, data: "" }),
      ),
    ).toThrow(SerialProtocolError)
  })

  it("round-trips a request", () => {
    const frame = {
      type: "request" as const,
      id: 7,
      method: "port.open" as const,
      params: {
        path: "/dev/ttyUSB0",
        settings: { baudRate: 9600, dataBits: 8, parity: "none", stopBits: 1, flowControl: "none" },
      },
    }
    expect(parseServerFrame(encodeFrame(frame))).toEqual(frame)
  })
})

describe("serial method schemas", () => {
  it("covers every method", () => {
    expect(Object.keys(serialMethodSchemas).sort()).toEqual([
      "port.break",
      "port.close",
      "port.open",
      "port.subscribe",
      "port.unsubscribe",
      "port.write",
      "ports.list",
    ])
  })

  it("rejects a bad port.open result", () => {
    expect(() =>
      serialMethodSchemas["port.open"].result.parse({
        handle: "p1",
        reused: false,
        start: 10,
        end: 5,
      }),
    ).toThrow()
  })

  it("rejects a bad break duration", () => {
    expect(() =>
      serialMethodSchemas["port.break"].params.parse({ handle: "p1", durationMs: 0 }),
    ).toThrow()
  })
})
