import { describe, expect, test } from "vitest"
import { Config, resolveConfig } from "../src/config"

describe("config", () => {
  test("fills the documented defaults", () => {
    const parsed = Config({ executablePath: "/opt/chromium" })
    expect(parsed.headless).toBe(true)
    expect(parsed.launchArgs).toEqual([])
    expect(parsed.maxOutputBytes).toBe(30000)
    expect(parsed.toolCallTimeoutMs).toBe(120000)
  })

  test("requires an executable path", () => {
    expect(() => resolveConfig(Config({ executablePath: "" }))).toThrow(
      /executablePath is required/,
    )
    expect(() => resolveConfig(Config({ executablePath: "   " }))).toThrow(
      /executablePath is required/,
    )
  })

  test("keeps the configured path and copies the launch arguments", () => {
    const launchArgs = ["--no-sandbox"]
    const resolved = resolveConfig(
      Config({ executablePath: "/opt/chromium", headless: false, launchArgs }),
    )
    launchArgs.push("--mute-audio")
    expect(resolved.executablePath).toBe("/opt/chromium")
    expect(resolved.headless).toBe(false)
    expect(resolved.launchArgs).toEqual(["--no-sandbox"])
  })

  test("refuses output and timeout values that are not positive integers", () => {
    expect(() =>
      resolveConfig(Config({ executablePath: "/opt/chromium", maxOutputBytes: 0 })),
    ).toThrow(/maxOutputBytes/)
    expect(() =>
      resolveConfig(Config({ executablePath: "/opt/chromium", toolCallTimeoutMs: 0 })),
    ).toThrow(/toolCallTimeoutMs/)
  })

  test("refuses a non-boolean headless value from programmatic construction", () => {
    const raw = {
      executablePath: "/opt/chromium",
      headless: "yes",
      launchArgs: [],
      maxOutputBytes: 30000,
      toolCallTimeoutMs: 120000,
    }
    expect(() => resolveConfig(raw as never)).toThrow(/headless/)
  })
})
