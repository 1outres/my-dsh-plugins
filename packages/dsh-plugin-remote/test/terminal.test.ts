import { describe, expect, it } from "vitest"
import { compilePromptPattern, endsWithPrompt, TerminalBuffer } from "../src/host/sessions/terminal"

describe("TerminalBuffer", () => {
  it("returns plain lines for plain output", () => {
    const buffer = new TerminalBuffer()
    buffer.write("hello\nworld")
    expect(buffer.all()).toEqual(["hello", "world"])
  })

  it("strips CSI and OSC sequences", () => {
    const buffer = new TerminalBuffer()
    buffer.write("\u001b[31mred\u001b[0m\n\u001b]0;title\u0007done")
    expect(buffer.all()).toEqual(["red", "done"])
  })

  it("keeps escape sequences split across chunks invisible", () => {
    const buffer = new TerminalBuffer()
    buffer.write("a\u001b[")
    buffer.write("32mb")
    expect(buffer.all()).toEqual(["ab"])
  })

  it("overwrites a line on carriage return", () => {
    const buffer = new TerminalBuffer()
    buffer.write("progress 10%\rprogress 100%")
    expect(buffer.all()).toEqual(["progress 100%"])
  })

  it("treats carriage return plus newline as one line break", () => {
    const buffer = new TerminalBuffer()
    buffer.write("one\r\ntwo")
    expect(buffer.all()).toEqual(["one", "two"])
  })

  it("applies backspace", () => {
    const buffer = new TerminalBuffer()
    buffer.write("abc\b\bX")
    expect(buffer.all()).toEqual(["aX"])
  })

  it("reports output since a mark", () => {
    const buffer = new TerminalBuffer()
    buffer.write("old\n")
    const mark = buffer.mark()
    buffer.write("new\npartial")
    expect(buffer.since(mark)).toBe("new\npartial")
  })

  it("pages history with 1-based offsets", () => {
    const buffer = new TerminalBuffer()
    buffer.write("a\nb\nc\nd")
    expect(buffer.page(2, 2)).toEqual({ lines: ["b", "c"], offset: 2, count: 2, totalLines: 4 })
  })

  it("drops the oldest lines past its cap", () => {
    const buffer = new TerminalBuffer(2)
    buffer.write("a\nb\nc\n")
    expect(buffer.all()).toEqual(["b", "c"])
    expect(buffer.page(1, 5).totalLines).toBe(3)
  })

  it("finds a prompt on the current line", () => {
    const pattern = compilePromptPattern("[>#$%]\\s*$")
    const buffer = new TerminalBuffer()
    buffer.write("last login\nuser@host:~$ ")
    expect(endsWithPrompt(buffer.promptLine(), pattern)).toBe(true)
  })

  it("does not report a prompt in the middle of a line", () => {
    const pattern = compilePromptPattern("[>#$%]\\s*$")
    expect(endsWithPrompt("user@host:~$ ls", pattern)).toBe(false)
  })
})
