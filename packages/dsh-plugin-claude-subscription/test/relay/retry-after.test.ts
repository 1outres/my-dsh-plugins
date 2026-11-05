import { describe, expect, it } from "vitest"
import { retryAfterMs } from "../../src/relay/retry-after"

const NOW = Date.parse("2026-11-05T12:00:00Z")

describe("retryAfterMs", () => {
  it.each([
    ["30", 30_000],
    [" 7 ", 7_000],
    ["1", 1_000],
    ["3600", 3_600_000],
  ])("reads %j as seconds", (value, expected) => {
    expect(retryAfterMs(value, NOW)).toBe(expected)
  })

  it("reads an HTTP date as the time left until it", () => {
    expect(retryAfterMs("Thu, 05 Nov 2026 12:01:30 GMT", NOW)).toBe(90_000)
  })

  it.each([
    ["absent", undefined],
    ["empty", ""],
    ["blank", "   "],
    ["zero, which DSH refuses", "0"],
    ["a negative number", "-5"],
    ["a fraction", "1.5"],
    ["words", "soon"],
    ["a number with a unit", "30s"],
    ["a date in the past", "Thu, 05 Nov 2026 11:59:00 GMT"],
    ["the present", "Thu, 05 Nov 2026 12:00:00 GMT"],
    ["a number too large for a safe integer", "9".repeat(30)],
    ["a repeated header", ["5", "6"]],
  ])("is null for %s", (_name, value) => {
    expect(retryAfterMs(value, NOW)).toBeNull()
  })
})
