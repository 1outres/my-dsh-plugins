import type { SubprocessHandle, SubprocessOutcome } from "@deepseek-ai/dsh-subprocess"
import type { JsonObject } from "../contract"
import { FailureCode, NativeFailure } from "../errors"
import { abortedFailure, stderrSuffix, timeoutFailure } from "./failures"

const SHOWN_LINE_CHARS = 300

type ChannelItem =
  | { kind: "event"; event: JsonObject }
  | { kind: "malformed"; line: string }
  | { kind: "failed"; error: unknown }
  | { kind: "ended" }

function parseLine(line: string): ChannelItem {
  try {
    const parsed: unknown = JSON.parse(line)
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return { kind: "event", event: parsed as JsonObject }
    }
  } catch {
    return { kind: "malformed", line }
  }
  return { kind: "malformed", line }
}

function endOf(stream: NodeJS.ReadableStream | undefined): Promise<void> {
  if (stream === undefined) return Promise.resolve()
  return new Promise((resolve) => {
    stream.once("end", resolve)
    stream.once("close", resolve)
  })
}

export interface ChannelOptions {
  idleMs: number
  signal: AbortSignal | undefined
  /** Cleans text from the CLI before it enters a failure message. */
  redact: (text: string) => string
}

/**
 * The stream-json conversation with one CLI process. It reads stdout from the moment it is built,
 * so the child can never block on a full pipe. Every wait is bounded by the idle limit and by the
 * caller's signal, but time the caller spends between two calls does not count.
 */
export class NativeChannel {
  readonly #handle: SubprocessHandle
  readonly #idleMs: number
  readonly #signal: AbortSignal | undefined
  readonly #redact: (text: string) => string
  readonly #items: ChannelItem[] = []
  #waiter: ((item: ChannelItem) => void) | null = null
  #partialLine = ""
  #discarding = false
  #outcome: SubprocessOutcome | null = null

  constructor(handle: SubprocessHandle, options: ChannelOptions) {
    this.#handle = handle
    this.#idleMs = options.idleMs
    this.#signal = options.signal
    this.#redact = options.redact
    // A write to a child that has gone reports through the write callback as well. Without this
    // listener the same error would also crash the host as an unhandled stream error.
    handle.stdin?.on("error", () => {})
    handle.stdout?.setEncoding("utf8")
    handle.stdout?.on("data", (chunk: string) => this.#onOutput(chunk))
    handle.stdout?.on("error", () => {})
    this.#watchEnd()
  }

  /** The exit code, known once `receive` has returned null. */
  get exitCode(): number | null {
    return this.#outcome?.exitCode ?? null
  }

  /** Suffix for a failure message, from the CLI's stderr. */
  stderrTail(): string {
    return stderrSuffix(this.#redact(this.#handle.collected.stderr?.readFrom(0).text ?? ""))
  }

  /** The next stream-json object, or null when the process and its stdout have ended. */
  async receive(): Promise<JsonObject | null> {
    if (this.#signal?.aborted === true) throw abortedFailure()
    const item = await this.#bounded(this.#nextItem())
    switch (item.kind) {
      case "event":
        return item.event
      case "ended":
        return null
      case "malformed":
        throw new NativeFailure(
          `Invalid native stream-json output: ${JSON.stringify(this.#redact(item.line).slice(0, SHOWN_LINE_CHARS))}${this.stderrTail()}`,
          FailureCode.nativeProtocol,
        )
      case "failed":
        throw new NativeFailure(
          `Native process failed: ${item.error instanceof Error ? item.error.message : String(item.error)}${this.stderrTail()}`,
          FailureCode.nativeProtocol,
          { cause: item.error },
        )
    }
  }

  /**
   * Writes one line to stdin and waits until the pipe took it. A child that is gone leaves
   * nothing to write to: what it printed, read by `receive`, is the better diagnosis.
   */
  async write(line: string): Promise<void> {
    const { stdin } = this.#handle
    if (stdin === undefined || stdin.destroyed) return
    await this.#bounded(new Promise<void>((resolve) => stdin.write(line, () => resolve())))
  }

  async endInput(): Promise<void> {
    const { stdin } = this.#handle
    if (stdin === undefined || stdin.destroyed) return
    await this.#bounded(new Promise<void>((resolve) => stdin.end(() => resolve())))
  }

  /** Keeps stdout flowing with nobody reading, so a draining child never blocks on it. */
  discardOutput(): void {
    this.#discarding = true
    this.#items.length = 0
    this.#waiter = null
  }

  /** Releases the pipes. Call once the process has gone. */
  close(): void {
    this.#handle.stdin?.destroy()
    this.#handle.stdout?.destroy()
  }

  #watchEnd(): void {
    Promise.all([endOf(this.#handle.stdout), this.#handle.done]).then(
      ([, outcome]) => {
        this.#outcome = outcome
        this.#flushPartialLine()
        this.#push({ kind: "ended" })
      },
      (error: unknown) => this.#push({ kind: "failed", error }),
    )
  }

  #onOutput(chunk: string): void {
    if (this.#discarding) return
    const lines = `${this.#partialLine}${chunk}`.split("\n")
    this.#partialLine = lines.pop() ?? ""
    for (const line of lines) this.#pushLine(line)
  }

  #flushPartialLine(): void {
    this.#pushLine(this.#partialLine)
    this.#partialLine = ""
  }

  #pushLine(line: string): void {
    if (line.trim() !== "") this.#push(parseLine(line))
  }

  #push(item: ChannelItem): void {
    if (this.#discarding) return
    if (this.#waiter === null) {
      this.#items.push(item)
      return
    }
    const waiter = this.#waiter
    this.#waiter = null
    waiter(item)
  }

  #nextItem(): Promise<ChannelItem> {
    const queued = this.#items.shift()
    if (queued !== undefined) return Promise.resolve(queued)
    return new Promise((resolve) => {
      this.#waiter = resolve
    })
  }

  #bounded<T>(work: Promise<T>): Promise<T> {
    const signal = this.#signal
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => finish(() => reject(abortedFailure()))
      const timer = setTimeout(() => finish(() => reject(timeoutFailure())), this.#idleMs)
      const finish = (settle: () => void) => {
        clearTimeout(timer)
        signal?.removeEventListener("abort", onAbort)
        settle()
      }
      signal?.addEventListener("abort", onAbort, { once: true })
      work.then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      )
    })
  }
}
