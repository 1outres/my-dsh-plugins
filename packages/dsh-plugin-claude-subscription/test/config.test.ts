import { describe, expect, it } from "vitest"
import { Config, readSettings } from "../src/config"

describe("Config", () => {
  it("gives the documented defaults", () => {
    expect(readSettings(Config({}))).toEqual({
      command: "claude",
      claudeConfigDir: "",
      claudeCodeTelemetry: true,
      readIdleTimeoutSeconds: 1800,
    })
  })

  it("reads user values", () => {
    const settings = readSettings(
      Config({
        command: "/opt/claude",
        claudeConfigDir: "/home/me/.claude-work",
        claudeCodeTelemetry: false,
        readIdleTimeoutSeconds: 60,
      }),
    )
    expect(settings).toEqual({
      command: "/opt/claude",
      claudeConfigDir: "/home/me/.claude-work",
      claudeCodeTelemetry: false,
      readIdleTimeoutSeconds: 60,
    })
  })

  it("makes every field volatile, so a change applies to the next call", () => {
    const parsed = Config({})
    for (const value of Object.values(parsed)) {
      expect(typeof (value as { get?: unknown }).get).toBe("function")
    }
  })

  it("refuses a read timeout that is not positive", () => {
    expect(() => Config({ readIdleTimeoutSeconds: 0 })).toThrow()
  })

  it("accepts the largest read timeout that Node can arm as a timer", () => {
    const seconds = 2_147_483
    expect(Config({ readIdleTimeoutSeconds: seconds }).readIdleTimeoutSeconds.get()).toBe(seconds)
    expect(seconds * 1000).toBeLessThanOrEqual(2 ** 31 - 1)
  })

  it("refuses a read timeout that Node would fire at once", () => {
    expect(() => Config({ readIdleTimeoutSeconds: 2_147_484 })).toThrow()
    expect(() => Config({ readIdleTimeoutSeconds: 1e9 })).toThrow()
  })

  it("refuses an empty command", () => {
    expect(() => Config({ command: "" })).toThrow()
  })
})
