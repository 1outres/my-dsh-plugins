import { describe, expect, it } from "vitest"
import {
  authorParts,
  failureText,
  firstLine,
  fullTime,
  relativeTime,
  shortSessionId,
} from "../src/client/format"
import { ja } from "../src/client/i18n"
import { dictionaryTranslator, translate } from "./client-support"

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0)
const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe("format", () => {
  it("uses the first line of a description", () => {
    expect(firstLine("First line\nSecond line")).toBe("First line")
    expect(firstLine("")).toBe("")
    expect(firstLine("  padded  ")).toBe("padded")
  })

  it("shortens a session id to eight characters", () => {
    expect(shortSessionId("abcdef123456")).toBe("abcdef12")
    expect(shortSessionId("abc")).toBe("abc")
  })

  it("names a comment author and keeps the agent id apart", () => {
    expect(authorParts({ kind: "user" }, translate)).toEqual({ name: "You", id: undefined })
    expect(authorParts({ kind: "agent", sessionId: "abcdef123456" }, translate)).toEqual({
      name: "Agent",
      id: "abcdef12",
    })
    expect(
      authorParts({ kind: "agent", sessionId: "abcdef123456" }, dictionaryTranslator(ja)),
    ).toEqual({
      name: "エージェント",
      id: "abcdef12",
    })
  })

  it("renders a failure with its message", () => {
    expect(
      failureText(
        { status: "error", error: { code: "invalid_input", message: "nope" } },
        translate,
        "saveFailed",
      ),
    ).toBe("Could not save: nope")
    expect(failureText({ status: "ok", value: 1 }, translate, "saveFailed")).toBeUndefined()
  })
})

describe("relative time", () => {
  it("reads now under a minute, also for a clock a little ahead", () => {
    expect(relativeTime(NOW, NOW, "en")).toBe("now")
    expect(relativeTime(NOW - 59 * SECOND, NOW, "en")).toBe("now")
    expect(relativeTime(NOW + 30 * SECOND, NOW, "en")).toBe("now")
    expect(relativeTime(NOW - 30 * SECOND, NOW, "ja")).toBe("今")
  })

  it("counts minutes, hours and days", () => {
    expect(relativeTime(NOW - MINUTE, NOW, "en")).toBe("1 minute ago")
    expect(relativeTime(NOW - 5 * MINUTE, NOW, "en")).toBe("5 minutes ago")
    expect(relativeTime(NOW - 59 * MINUTE, NOW, "en")).toBe("59 minutes ago")
    expect(relativeTime(NOW - 3 * HOUR, NOW, "en")).toBe("3 hours ago")
    expect(relativeTime(NOW - 23 * HOUR, NOW, "en")).toBe("23 hours ago")
    expect(relativeTime(NOW - DAY, NOW, "en")).toBe("yesterday")
    expect(relativeTime(NOW - 2 * DAY, NOW, "en")).toBe("2 days ago")
    expect(relativeTime(NOW - 6 * DAY, NOW, "en")).toBe("6 days ago")
    expect(relativeTime(NOW - 5 * MINUTE, NOW, "ja")).toBe("5 分前")
    expect(relativeTime(NOW - 3 * HOUR, NOW, "ja")).toBe("3 時間前")
    expect(relativeTime(NOW - 3 * DAY, NOW, "ja")).toBe("3 日前")
  })

  it("shows a short date from a week on", () => {
    expect(relativeTime(Date.UTC(2026, 10, 3, 12), NOW, "en")).toBe("Nov 3")
    expect(relativeTime(Date.UTC(2026, 10, 3, 12), NOW, "ja")).toBe("11月3日")
  })

  it("adds the year to a date of another year", () => {
    expect(relativeTime(Date.UTC(2025, 10, 3, 12), NOW, "en")).toBe("Nov 3, 2025")
    expect(relativeTime(Date.UTC(2025, 10, 3, 12), NOW, "ja")).toBe("2025年11月3日")
  })

  it("shows the full local time with the year", () => {
    expect(fullTime(Date.UTC(2025, 10, 3, 12), "en")).toContain("2025")
    expect(fullTime(Date.UTC(2025, 10, 3, 12), "ja")).toContain("2025")
  })
})
