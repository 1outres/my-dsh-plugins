import { describe, expect, it } from "vitest"
import { authorText, failureText, firstLine, shortSessionId } from "../src/client/format"
import { translate } from "./client-support"

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

  it("names a comment author", () => {
    expect(authorText({ kind: "user" }, translate)).toBe("You")
    expect(authorText({ kind: "agent", sessionId: "abcdef123456" }, translate)).toBe(
      "Agent (abcdef12)",
    )
  })

  it("renders a failure with its message", () => {
    expect(
      failureText(
        { status: "error", error: { code: "invalid_input", message: "nope" } },
        translate,
        "saveCardFailed",
      ),
    ).toBe("Could not save the card: nope")
    expect(failureText({ status: "ok", value: 1 }, translate, "saveCardFailed")).toBeUndefined()
  })
})
