import { describe, expect, it } from "vitest"
import { DEFAULT_SERIAL_SETTINGS, formatSerialSettings } from "../src/shared/serial"

describe("formatSerialSettings", () => {
  it("writes the usual 8N1 form", () => {
    expect(formatSerialSettings(DEFAULT_SERIAL_SETTINGS)).toBe("9600 8N1")
  })

  it("adds parity, stop bits and flow control", () => {
    expect(
      formatSerialSettings({
        baudRate: 115200,
        dataBits: 7,
        parity: "even",
        stopBits: 2,
        flowControl: "rtscts",
      }),
    ).toBe("115200 7E2 rtscts")
  })

  it("marks odd parity and software flow control", () => {
    expect(
      formatSerialSettings({
        baudRate: 19200,
        dataBits: 8,
        parity: "odd",
        stopBits: 1,
        flowControl: "xonxoff",
      }),
    ).toBe("19200 8O1 xonxoff")
  })
})
