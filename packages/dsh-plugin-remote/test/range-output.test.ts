import { describe, expect, it } from "vitest"
import { replaceLiteral, sliceFileLines, splitFileLines } from "../src/host/files/range"
import { formatExecOutput, redactSecrets, truncateTail } from "../src/host/output"

describe("file line windows", () => {
  it("treats a final newline as a terminator", () => {
    expect(splitFileLines("a\nb\n")).toEqual(["a", "b"])
    expect(splitFileLines("")).toEqual([])
  })

  it("returns a numbered window", () => {
    expect(sliceFileLines("a\nb\nc\nd", "/x", 2, 2)).toEqual({
      path: "/x",
      offset: 2,
      totalLines: 4,
      lines: [
        { number: 2, text: "b" },
        { number: 3, text: "c" },
      ],
      truncated: true,
    })
  })

  it("returns an empty window past the end", () => {
    expect(sliceFileLines("a\n", "/x", 5, 10)).toMatchObject({ lines: [], truncated: false })
  })
})

describe("literal replacement", () => {
  it("replaces one unique match", () => {
    expect(replaceLiteral("one two", "two", "Three", false)).toEqual({
      content: "one Three",
      replacements: 1,
    })
  })

  it("refuses an ambiguous match unless replace_all is set", () => {
    expect(() => replaceLiteral("a a", "a", "b", false)).toThrow(/appears 2 times/)
    expect(replaceLiteral("a a", "a", "b", true)).toEqual({ content: "b b", replacements: 2 })
  })

  it("refuses a missing or empty search string", () => {
    expect(() => replaceLiteral("abc", "z", "y", false)).toThrow(/not found/)
    expect(() => replaceLiteral("abc", "", "y", false)).toThrow(/empty/)
  })
})

describe("output helpers", () => {
  it("keeps the tail and does not split a UTF-8 character", () => {
    const result = truncateTail("abc日本語", 7)
    expect(result.truncated).toBe(true)
    expect(result.text).toBe("本語")
  })

  it("leaves short output unchanged", () => {
    expect(truncateTail("short", 100)).toEqual({ text: "short", truncated: false })
  })

  it("redacts known values, longest first", () => {
    expect(redactSecrets("password=abcdef; abc", ["abc", "abcdef"])).toBe(
      "password=********; ********",
    )
  })

  it("formats an exec result with the exit code and stderr", () => {
    const text = formatExecOutput({
      exitCode: 2,
      stdout: "out",
      stderr: "err",
      timedOut: false,
      truncated: false,
    })
    expect(text).toContain("Exit code: 2")
    expect(text).toContain("out")
    expect(text).toContain("stderr:\nerr")
  })
})
