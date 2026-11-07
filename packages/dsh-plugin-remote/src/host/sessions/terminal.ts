const ESC = "\u001b"
const BEL = "\u0007"

type ParseState = "text" | "escape" | "charset" | "csi" | "osc" | "osc-escape"

/**
 * Turns a remote PTY byte stream into plain lines. It understands the ANSI
 * sequences that terminals emit, carriage returns that overwrite a line, and
 * backspaces. Full-screen programs are out of scope.
 */
export class TerminalBuffer {
  readonly #maxLines: number
  #lines: string[] = []
  #current = ""
  #baseLine = 0
  #state: ParseState = "text"
  #pendingCR = false

  constructor(maxLines = 10000) {
    this.#maxLines = maxLines
  }

  get absoluteLines(): number {
    return this.#baseLine + this.#lines.length
  }

  /** Number of completed lines; a later `since` starts after them. */
  mark(): number {
    return this.absoluteLines
  }

  write(chunk: string): void {
    for (const char of chunk) this.#feed(char)
  }

  /** The line a prompt would sit on, or the last completed line when the PTY left it empty. */
  promptLine(): string {
    if (this.#current.length > 0) return this.#current
    return this.#lines.at(-1) ?? ""
  }

  /** Text appended since `mark`, including the current unfinished line. */
  since(mark: number): string {
    const first = Math.max(0, mark - this.#baseLine)
    const completed = this.#lines.slice(first)
    if (this.#current.length === 0) return completed.join("\n")
    return [...completed, this.#current].join("\n")
  }

  /** Whole visible output, oldest first. */
  all(): string[] {
    return this.#current.length === 0 ? [...this.#lines] : [...this.#lines, this.#current]
  }

  /** One page of history; `offset` is 1-based and counts from the first kept line. */
  page(
    offset: number,
    count: number,
  ): { lines: string[]; offset: number; count: number; totalLines: number } {
    const all = this.all()
    const total = this.#baseLine + all.length
    const start = Math.max(0, offset - 1 - this.#baseLine)
    const end = start + count
    return { lines: all.slice(start, end), offset, count, totalLines: total }
  }

  #feed(char: string): void {
    if (this.#pendingCR) {
      this.#pendingCR = false
      if (char === "\n") {
        this.#flush()
        return
      }
      this.#current = ""
    }
    switch (this.#state) {
      case "escape":
        this.#consumeEscape(char)
        return
      case "charset":
        this.#state = "text"
        return
      case "csi":
        if (char >= "\u0040" && char <= "\u007e") this.#state = "text"
        return
      case "osc":
        if (char === BEL) this.#state = "text"
        else if (char === ESC) this.#state = "osc-escape"
        return
      case "osc-escape":
        if (char === "\\") this.#state = "text"
        else if (char !== ESC) this.#state = "osc"
        return
      case "text":
        this.#consumeText(char)
    }
  }

  #consumeEscape(char: string): void {
    if (char === "[") this.#state = "csi"
    else if (char === "]") this.#state = "osc"
    else if (char === "(" || char === ")") this.#state = "charset"
    else this.#state = "text"
  }

  #consumeText(char: string): void {
    if (char === ESC) {
      this.#state = "escape"
      return
    }
    if (char === "\r") {
      this.#pendingCR = true
      return
    }
    if (char === "\n") {
      this.#flush()
      return
    }
    if (char === "\b") {
      this.#current = Array.from(this.#current).slice(0, -1).join("")
      return
    }
    if (char === "\t") {
      this.#current += "\t"
      return
    }
    if (char < " ") return
    this.#current += char
  }

  #flush(): void {
    this.#lines.push(this.#current)
    this.#current = ""
    if (this.#lines.length <= this.#maxLines) return
    const drop = this.#lines.length - this.#maxLines
    this.#lines.splice(0, drop)
    this.#baseLine += drop
  }
}

/** Compile a target prompt pattern once, with a readable failure. */
export function compilePromptPattern(pattern: string): RegExp {
  try {
    return new RegExp(pattern, "u")
  } catch (error) {
    throw new Error(
      `promptPattern is not a valid regular expression: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/** Whether the visible tail ends on a line the prompt pattern matches. */
export function endsWithPrompt(line: string, pattern: RegExp): boolean {
  if (line.length === 0) return false
  const regex = new RegExp(pattern.source, pattern.flags.replaceAll("g", "").replaceAll("y", ""))
  const match = regex.exec(line)
  return match !== null && match.index + match[0].length === line.length
}
