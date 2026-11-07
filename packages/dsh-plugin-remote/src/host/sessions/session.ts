import type {
  RemoteSessionStatus,
  RemoteTarget,
  SessionBoundary,
  SessionOpenResult,
  SessionReadResult,
  SessionSendResult,
} from "../../shared/types"
import { truncateTail } from "../output"
import type {
  RemoteTransport,
  ShellHandle,
  TransportCall,
  TransportPrompter,
} from "../transport/transport"
import { compilePromptPattern, endsWithPrompt, TerminalBuffer } from "./terminal"

export interface InteractiveOptions {
  defaultPromptPattern: string
  idleMs: number
  sendTimeoutMs: number
  maxOutputBytes: number
  /** Values to hide from every transcript, resolved at read time. */
  secretValues: () => string[]
}

export interface SendInput {
  text?: string
  secret?: string
  submit: boolean
  wait: boolean
  timeoutMs: number
}

interface Boundary {
  reason: SessionBoundary
  exitCode?: number
}

class InteractiveSession {
  readonly id: string
  readonly target: RemoteTarget
  readonly name: string | undefined
  readonly shell: ShellHandle
  readonly buffer = new TerminalBuffer()
  readonly pattern: RegExp
  readonly redactions = new Set<string>()
  state: "open" | "exited" = "open"
  exitCode: number | undefined
  lastReason: SessionBoundary = "idle"

  constructor(
    id: string,
    target: RemoteTarget,
    name: string | undefined,
    shell: ShellHandle,
    pattern: RegExp,
  ) {
    this.id = id
    this.target = target
    this.name = name
    this.shell = shell
    this.pattern = pattern
    shell.onData((chunk) => this.buffer.write(chunk))
    shell.onExit((code) => {
      this.state = "exited"
      this.exitCode = code ?? undefined
    })
  }

  status(): RemoteSessionStatus {
    return {
      id: this.id,
      target: this.target.name,
      ...(this.name === undefined ? {} : { name: this.name }),
      state: this.state,
      ...(this.exitCode === undefined ? {} : { exitCode: this.exitCode }),
    }
  }
}

/** Interactive shells for one root session. */
export class InteractiveSessions {
  readonly #sessions = new Map<string, InteractiveSession>()
  readonly #transport: RemoteTransport
  readonly #options: InteractiveOptions
  #nextId = 1

  constructor(transport: RemoteTransport, options: InteractiveOptions) {
    this.#transport = transport
    this.#options = options
  }

  async open(
    target: RemoteTarget,
    name: string | undefined,
    call: TransportCall,
  ): Promise<SessionOpenResult> {
    const existing = [...this.#sessions.values()].find(
      (session) =>
        session.target.name === target.name && session.name === name && session.state === "open",
    )
    if (existing !== undefined) {
      return { session: existing.status(), output: "", reason: "idle", reused: true }
    }
    const pattern = compilePromptPattern(target.promptPattern ?? this.#options.defaultPromptPattern)
    const shell = await this.#transport.openShell(target, call)
    const session = new InteractiveSession(
      `session-${String(this.#nextId++)}`,
      target,
      name,
      shell,
      pattern,
    )
    this.#sessions.set(session.id, session)
    const start = session.buffer.mark()
    const opening = await this.#waitForBoundary(
      session,
      this.#options.sendTimeoutMs,
      call.signal,
      false,
    )
    session.lastReason = opening.reason
    if (opening.reason !== "exited") {
      for (const command of target.initCommands) {
        shell.write(`${command}\n`)
        const boundary = await this.#waitForBoundary(
          session,
          this.#options.sendTimeoutMs,
          call.signal,
          true,
        )
        session.lastReason = boundary.reason
        if (boundary.reason === "exited") break
      }
    }
    return {
      session: session.status(),
      output: this.#clip(this.#redact(session, session.buffer.since(start))),
      reason: session.state === "exited" ? "exited" : session.lastReason,
      reused: false,
    }
  }

  async send(
    sessionId: string,
    input: SendInput,
    call: TransportCall,
    prompter: TransportPrompter,
  ): Promise<SessionSendResult> {
    const session = this.#require(sessionId)
    if (session.state === "exited") {
      throw new Error(
        `Session ${sessionId} has already exited${session.exitCode === undefined ? "" : ` (exit code ${String(session.exitCode)})`}`,
      )
    }
    let text = input.text
    if (input.secret !== undefined) {
      const value = await prompter.secret(session.target, input.secret, {})
      session.redactions.add(value)
      text = text === undefined ? value : text + value
    }
    if (text === undefined) throw new Error("remote_session_send needs text or secret")
    const mark = session.buffer.mark()
    session.shell.write(input.submit ? `${text}\n` : text)
    const boundary = input.wait
      ? await this.#waitForBoundary(session, input.timeoutMs, call.signal, true)
      : { reason: "idle" as const }
    session.lastReason = boundary.reason
    return {
      sessionId: session.id,
      output: this.#clip(this.#redact(session, session.buffer.since(mark))),
      reason: boundary.reason,
      state: session.state,
      ...(session.exitCode === undefined ? {} : { exitCode: session.exitCode }),
    }
  }

  read(sessionId: string, offset: number, count: number): SessionReadResult {
    const session = this.#require(sessionId)
    const page = session.buffer.page(offset, count)
    return {
      sessionId,
      offset: page.offset,
      count: page.count,
      totalLines: page.totalLines,
      lines: page.lines.map((line) => this.#redact(session, line)),
    }
  }

  close(sessionId: string): boolean {
    const session = this.#sessions.get(sessionId)
    if (session === undefined) return false
    this.#sessions.delete(sessionId)
    session.shell.kill()
    session.state = "exited"
    return true
  }

  statuses(): RemoteSessionStatus[] {
    return [...this.#sessions.values()].map((session) => session.status())
  }

  statusesFor(targetName: string): RemoteSessionStatus[] {
    return this.statuses().filter((status) => status.target === targetName)
  }

  dispose(): void {
    for (const session of this.#sessions.values()) session.shell.kill()
    this.#sessions.clear()
  }

  #require(id: string): InteractiveSession {
    const session = this.#sessions.get(id)
    if (session === undefined) throw new Error(`No remote session has id ${JSON.stringify(id)}`)
    return session
  }

  #redact(session: InteractiveSession, text: string): string {
    const values = [...session.redactions, ...this.#options.secretValues()]
      .filter((value) => value.length > 0)
      .sort((left, right) => right.length - left.length)
    let result = text
    for (const value of values) result = result.split(value).join("********")
    return result
  }

  #clip(text: string): string {
    return truncateTail(text, this.#options.maxOutputBytes).text
  }

  async #waitForBoundary(
    session: InteractiveSession,
    timeoutMs: number,
    signal: AbortSignal,
    afterWrite: boolean,
  ): Promise<Boundary> {
    return await new Promise<Boundary>((resolve, reject) => {
      let settled = false
      let idle: NodeJS.Timeout | undefined
      let deadline: NodeJS.Timeout | undefined
      let offData: () => void = () => {}
      let offExit: () => void = () => {}
      const settle = (boundary: Boundary): void => {
        if (settled) return
        settled = true
        if (idle !== undefined) clearTimeout(idle)
        if (deadline !== undefined) clearTimeout(deadline)
        offData()
        offExit()
        signal.removeEventListener("abort", onAbort)
        resolve(boundary)
      }
      const fail = (error: Error): void => {
        if (settled) return
        settled = true
        if (idle !== undefined) clearTimeout(idle)
        if (deadline !== undefined) clearTimeout(deadline)
        offData()
        offExit()
        signal.removeEventListener("abort", onAbort)
        reject(error)
      }
      const scheduleIdle = (): void => {
        if (idle !== undefined) clearTimeout(idle)
        idle = setTimeout(
          () => settle({ reason: "idle", ...exitCodeOf(session) }),
          this.#options.idleMs,
        )
        idle.unref()
      }
      const onAbort = (): void =>
        fail(
          signal.reason instanceof Error ? signal.reason : new Error("The tool call was cancelled"),
        )
      if (signal.aborted) {
        onAbort()
        return
      }
      if (session.state === "exited") {
        settle({ reason: "exited", ...exitCodeOf(session) })
        return
      }
      if (!afterWrite && endsWithPrompt(session.buffer.promptLine(), session.pattern)) {
        settle({ reason: "prompt", ...exitCodeOf(session) })
        return
      }
      signal.addEventListener("abort", onAbort, { once: true })
      deadline = setTimeout(() => settle({ reason: "timeout", ...exitCodeOf(session) }), timeoutMs)
      deadline.unref()
      offExit = session.shell.onExit(() => settle({ reason: "exited", ...exitCodeOf(session) }))
      offData = session.shell.onData(() => {
        if (endsWithPrompt(session.buffer.promptLine(), session.pattern)) {
          settle({ reason: "prompt", ...exitCodeOf(session) })
          return
        }
        scheduleIdle()
      })
      scheduleIdle()
    })
  }
}

function exitCodeOf(session: InteractiveSession): { exitCode?: number } {
  return session.exitCode === undefined ? {} : { exitCode: session.exitCode }
}
