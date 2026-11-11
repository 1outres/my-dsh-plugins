import { type ChildProcess, spawn } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { stat } from "node:fs/promises"
import { join } from "node:path"
import type { ExecResult, RemoteTarget, SshTarget } from "../../../shared/types"
import { truncateTail } from "../../output"
import { runProcess } from "../../process"
import type { SecretStore } from "../../secrets/store"
import type { FileHashOutcome, FileReadOutcome, ShellHandle, TransportPrompter } from "../transport"
import { classifyAskpassPrompt } from "./askpass-prompt"
import type { AskpassServer } from "./askpass-server"
import {
  buildExecArgv,
  buildHashScript,
  buildMasterArgv,
  buildProxyCommand,
  buildReadScript,
  buildShellArgv,
  buildSudoCommand,
  buildWriteScript,
  quoteCommand,
} from "./command"

export interface SshConnectionOptions {
  sshPath: string
  persistSeconds: number
  maxSecretRetries: number
  maxOutputBytes: number
  maxFileBytes: number
  askpass: AskpassServer
  secrets: SecretStore
}

interface MasterState {
  controlPath: string
  host: string
  token: string
  child?: ChildProcess
  ready: boolean
  connecting?: Promise<void>
  passwordlessSudo?: boolean
  failure?: string
}

const SHELL_CLOSE_WAIT_MS = 5000
const SHELL_CLOSE_KILL_WAIT_MS = 1000

interface CommandOutcome {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  truncated: boolean
}

export class SshConnectionError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "SshConnectionError"
    this.code = code
  }
}

/**
 * One root session's SSH connections. A target is connected through a
 * ControlMaster that askpass can authenticate; commands reuse that master.
 */
export class SshConnections {
  readonly #options: SshConnectionOptions
  readonly #sessionId: string
  readonly #resolveTarget: (name: string) => RemoteTarget | undefined
  readonly #states = new Map<string, MasterState>()

  constructor(
    sessionId: string,
    resolveTarget: (name: string) => RemoteTarget | undefined,
    options: SshConnectionOptions,
  ) {
    this.#sessionId = sessionId
    this.#resolveTarget = resolveTarget
    this.#options = options
  }

  async connect(
    target: SshTarget,
    prompter: TransportPrompter,
    signal: AbortSignal,
  ): Promise<void> {
    const state = this.#state(target)
    if (await this.#isAlive(target, state, signal)) return
    if (state.connecting !== undefined) {
      await raceAbort(state.connecting, signal)
      return
    }
    const connecting = this.#connectWithRetry(target, prompter, signal)
    state.connecting = connecting
    try {
      await connecting
    } finally {
      if (state.connecting === connecting) state.connecting = undefined
    }
  }

  async isConnected(target: SshTarget, signal: AbortSignal): Promise<boolean> {
    return await this.#isAlive(target, this.#state(target), signal)
  }

  async exec(
    target: SshTarget,
    command: string,
    stdin: string | undefined,
    sudo: boolean,
    timeoutMs: number,
    prompter: TransportPrompter,
    signal: AbortSignal,
  ): Promise<ExecResult> {
    await this.connect(target, prompter, signal)
    let attempts = 0
    for (;;) {
      const outcome = await this.#runCommand(
        target,
        command,
        stdin,
        sudo,
        timeoutMs,
        prompter,
        signal,
      )
      if (!sudo || !isSudoAuthFailure(outcome)) {
        return {
          exitCode: outcome.code,
          stdout: outcome.stdout,
          stderr: outcome.stderr,
          timedOut: outcome.timedOut,
          truncated: outcome.truncated,
        }
      }
      if (attempts >= this.#options.maxSecretRetries) {
        return {
          exitCode: outcome.code,
          stdout: outcome.stdout,
          stderr: outcome.stderr,
          timedOut: outcome.timedOut,
          truncated: outcome.truncated,
        }
      }
      attempts += 1
      this.#options.secrets.deleteField(this.#sessionId, target.name, "sudo")
      await this.#sudoPassword(target, prompter, true, signal)
    }
  }

  async readFile(
    target: SshTarget,
    path: string,
    sudo: boolean,
    prompter: TransportPrompter,
    signal: AbortSignal,
  ): Promise<FileReadOutcome> {
    await this.connect(target, prompter, signal)
    const outcome = await this.#runCommand(
      target,
      buildReadScript(path),
      undefined,
      sudo,
      this.#fileTimeout(),
      prompter,
      signal,
      true,
    )
    if (outcome.code !== 0) throw fileError("Could not read the remote file", outcome)
    const newline = outcome.stdout.indexOf("\n")
    const header = newline === -1 ? outcome.stdout : outcome.stdout.slice(0, newline)
    if (header === "MISSING") return { exists: false, hash: "", content: "" }
    if (!/^[0-9a-f]{64}$/u.test(header))
      throw new SshConnectionError(
        "REMOTE_READ_FAILED",
        `Unexpected reply while reading the remote file: ${header.slice(0, 120)}`,
      )
    const body = newline === -1 ? "" : outcome.stdout.slice(newline + 1)
    const content = Buffer.from(body.replace(/\s+/gu, ""), "base64").toString("utf8")
    if (!verifyContentHash(content, header))
      throw new SshConnectionError(
        "REMOTE_READ_FAILED",
        "The remote file changed while it was read",
      )
    return { exists: true, hash: header, content }
  }

  async hashFile(
    target: SshTarget,
    path: string,
    sudo: boolean,
    prompter: TransportPrompter,
    signal: AbortSignal,
  ): Promise<FileHashOutcome> {
    await this.connect(target, prompter, signal)
    const outcome = await this.#runCommand(
      target,
      buildHashScript(path),
      undefined,
      sudo,
      this.#fileTimeout(),
      prompter,
      signal,
      true,
    )
    if (outcome.code !== 0) throw fileError("Could not read the remote file", outcome)
    const value = outcome.stdout.trim()
    if (value === "MISSING") return { exists: false, hash: "" }
    if (!/^[0-9a-f]{64}$/u.test(value))
      throw new SshConnectionError(
        "REMOTE_READ_FAILED",
        "Unexpected reply while reading the remote file hash",
      )
    return { exists: true, hash: value }
  }

  async writeFile(
    target: SshTarget,
    path: string,
    content: string,
    expectedHash: string | null,
    sudo: boolean,
    prompter: TransportPrompter,
    signal: AbortSignal,
  ): Promise<void> {
    await this.connect(target, prompter, signal)
    const encoded = Buffer.from(content, "utf8").toString("base64")
    const outcome = await this.#runCommand(
      target,
      buildWriteScript(path, expectedHash),
      `${encoded}\n`,
      sudo,
      this.#fileTimeout(),
      prompter,
      signal,
      true,
    )
    if (outcome.code === 0) return
    if (outcome.code === 3)
      throw new SshConnectionError(
        "REMOTE_WRITE_CONFLICT",
        "The file changed on the remote since it was read; read it again before writing",
      )
    throw fileError("Could not write the remote file", outcome)
  }

  async openShell(
    target: SshTarget,
    prompter: TransportPrompter,
    signal: AbortSignal,
  ): Promise<ShellHandle> {
    await this.connect(target, prompter, signal)
    const state = this.#state(target)
    const shellArgv = buildShellArgv(this.#options.sshPath, target, state.controlPath)
    const child = spawn(shellArgv[0] as string, shellArgv.slice(1), {
      env: { ...process.env, LC_ALL: "C" },
      stdio: ["pipe", "pipe", "pipe"],
    })
    child.stdin.on("error", () => {})
    const listeners = new Set<(chunk: string) => void>()
    const exitListeners = new Set<(code: number | null) => void>()
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    const emit = (chunk: string): void => {
      for (const listener of [...listeners]) listener(chunk)
    }
    child.stdout.on("data", (chunk: string) => emit(chunk))
    child.stderr.on("data", (chunk: string) => emit(chunk))
    child.on("close", (code) => {
      for (const listener of [...exitListeners]) listener(code)
    })
    return {
      pid: child.pid,
      enter: "\n",
      write: (data: string) =>
        new Promise<void>((resolve, reject) => {
          child.stdin.write(data, (error) => {
            if (error === null || error === undefined) resolve()
            else reject(error)
          })
        }),
      sendBreak: async () => {
        throw new Error("The ssh transport does not support a BREAK")
      },
      onData: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      onExit: (listener) => {
        exitListeners.add(listener)
        return () => exitListeners.delete(listener)
      },
      get exitCode() {
        return child.exitCode
      },
      close: async () => {
        await closeShellChild(child)
      },
      kill: () => {
        if (child.exitCode === null) child.kill("SIGTERM")
      },
    }
  }

  async disconnect(targetName: string): Promise<void> {
    const state = this.#states.get(targetName)
    if (state === undefined) return
    this.#states.delete(targetName)
    this.#options.askpass.unbind(state.token)
    await this.#exitMaster(state)
  }

  async #exitMaster(state: MasterState): Promise<void> {
    const child = state.child
    state.child = undefined
    state.ready = false
    if (child !== undefined && child.exitCode === null) child.kill("SIGTERM")
    try {
      await runProcess([this.#options.sshPath, "-S", state.controlPath, "-O", "exit", state.host], {
        timeoutMs: 5000,
        env: { LC_ALL: "C" },
      })
    } catch {
      // The master is already gone; there is nothing left to stop.
    }
  }

  async disposeSession(): Promise<void> {
    await Promise.all([...this.#states.keys()].map(async (name) => this.disconnect(name)))
  }

  #state(target: SshTarget): MasterState {
    let state = this.#states.get(target.name)
    if (state === undefined) {
      const digest = createHash("sha256")
        .update(`${this.#sessionId}\u0000${target.name}`)
        .digest("hex")
        .slice(0, 24)
      state = {
        controlPath: join(this.#options.askpass.directory, `${digest}.sock`),
        host: target.host,
        token: randomUUID(),
        ready: false,
      }
      this.#states.set(target.name, state)
    }
    return state
  }

  async #isAlive(target: SshTarget, state: MasterState, signal: AbortSignal): Promise<boolean> {
    if (!state.ready) return false
    return await this.#checkMaster(target, state, signal)
  }

  async #checkMaster(target: SshTarget, state: MasterState, signal: AbortSignal): Promise<boolean> {
    const outcome = await runProcess(
      [this.#options.sshPath, "-S", state.controlPath, "-O", "check", target.host],
      {
        signal,
        timeoutMs: 5000,
        env: { LC_ALL: "C" },
      },
    )
    if (outcome.code !== 0) state.ready = false
    return outcome.code === 0
  }

  async #connectWithRetry(
    target: SshTarget,
    prompter: TransportPrompter,
    signal: AbortSignal,
  ): Promise<void> {
    let attempts = 0
    for (;;) {
      const failure = await this.#connectOnce(target, prompter, signal)
      if (failure === undefined) return
      if (failure.kind === "auth" && attempts < this.#options.maxSecretRetries) {
        attempts += 1
        this.#options.secrets.deleteField(this.#sessionId, target.name, "login")
        const value = await prompter.secret(target, "login", { retry: true })
        this.#options.secrets.set(this.#sessionId, target.name, "login", value)
        continue
      }
      throw new SshConnectionError(failure.kind, failure.message)
    }
  }

  async #connectOnce(
    target: SshTarget,
    prompter: TransportPrompter,
    signal: AbortSignal,
  ): Promise<{ kind: string; message: string } | undefined> {
    const jump = this.#jumpTarget(target)
    if (jump !== undefined) await this.connect(jump, prompter, signal)
    const state = this.#state(target)
    await this.#exitMaster(state)
    state.passwordlessSudo = undefined
    state.failure = undefined
    const env = this.#options.askpass.bind(
      state.token,
      this.#askpassHandler(target, prompter, state),
    )
    const proxy =
      jump === undefined
        ? undefined
        : buildProxyCommand(this.#options.sshPath, jump, this.#state(jump).controlPath)
    const masterArgv = buildMasterArgv(
      this.#options.sshPath,
      target,
      state.controlPath,
      this.#options.persistSeconds,
      proxy,
    )
    const child = spawn(masterArgv[0] as string, masterArgv.slice(1), {
      env: { ...process.env, ...env, LC_ALL: "C" },
      stdio: ["ignore", "pipe", "pipe"],
    })
    state.child = child
    child.stderr.setEncoding("utf8")
    let stderr = ""
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-8000)
    })
    const closed = new Promise<void>((resolve) => {
      child.once("close", () => resolve())
    })
    child.on("error", (error) => {
      stderr = `${stderr}\n${error.message}`
    })
    // With ControlPersist, OpenSSH moves the master to the background and the
    // foreground process exits 0. The socket, not the child, is the live fact.
    const graceUntil = Date.now() + 15_000
    try {
      for (;;) {
        if (await socketReady(state.controlPath)) {
          if (await this.#checkMaster(target, state, signal)) {
            return this.#markReady(state, child)
          }
        }
        if (child.exitCode !== null) {
          if (child.exitCode !== 0 || Date.now() > graceUntil) {
            await closed
            return failureOf(state.failure, stderr)
          }
        }
        await raceAbort(sleep(100), signal)
      }
    } catch (error) {
      child.stderr?.removeAllListeners("data")
      child.stderr?.resume()
      this.#options.askpass.unbind(state.token)
      if (child.exitCode === null) child.kill("SIGTERM")
      throw error
    }
  }

  #jumpTarget(target: SshTarget): SshTarget | undefined {
    if (target.jump === undefined) return undefined
    const jump = this.#resolveTarget(target.jump)
    if (jump === undefined)
      throw new SshConnectionError(
        "REMOTE_JUMP_MISSING",
        `The jump target ${JSON.stringify(target.jump)} is not registered`,
      )
    if (jump.transport !== "ssh")
      throw new SshConnectionError(
        "REMOTE_JUMP_UNSUPPORTED",
        "The jump target must use the ssh transport",
      )
    return jump
  }

  #markReady(state: MasterState, child: ChildProcess): undefined {
    state.ready = true
    this.#options.askpass.unbind(state.token)
    child.stderr?.removeAllListeners("data")
    child.stderr?.resume()
    return undefined
  }

  #askpassHandler(
    target: SshTarget,
    prompter: TransportPrompter,
    state: MasterState,
  ): (prompt: string) => Promise<string> {
    return async (prompt) => {
      const question = classifyAskpassPrompt(prompt)
      if (question.kind === "hostkey") {
        if (question.changed) {
          state.failure = "The remote host key changed. Refusing to connect."
          return "no"
        }
        const accepted = await prompter.hostKey(target, question.hostKey)
        if (!accepted) state.failure = "The user refused the host key."
        return accepted ? "yes" : "no"
      }
      if (question.kind === "secret") {
        const stored = this.#options.secrets.get(this.#sessionId, target.name, question.field)
        if (stored !== undefined) return stored
        const value = await prompter.secret(target, question.field, {})
        this.#options.secrets.set(this.#sessionId, target.name, question.field, value)
        return value
      }
      return await prompter.secret(target, "response", { label: question.label })
    }
  }

  async #runCommand(
    target: SshTarget,
    command: string,
    stdin: string | undefined,
    sudo: boolean,
    timeoutMs: number,
    prompter: TransportPrompter,
    signal: AbortSignal,
    fileCommand = false,
  ): Promise<CommandOutcome> {
    let remote = command
    let input = stdin
    if (sudo) {
      const passwordless = await this.#refreshPasswordlessSudo(target, signal)
      remote = buildSudoCommand(command, passwordless)
      if (!passwordless) {
        const password = await this.#sudoPassword(target, prompter, false, signal)
        input = `${password}\n${stdin ?? ""}`
      }
    }
    const state = this.#state(target)
    const argv = buildExecArgv(this.#options.sshPath, target, state.controlPath, remote)
    const run = async () =>
      await runProcess(argv, {
        env: { LC_ALL: "C" },
        input,
        signal,
        timeoutMs,
        maxBytes: fileCommand ? this.#options.maxFileBytes : 4_000_000,
      })
    let outcome = await run()
    if (outcome.code === 255 && isMuxFailure(outcome.stderr)) {
      await this.disconnect(target.name)
      await this.connect(target, prompter, signal)
      outcome = await run()
    }
    const out = truncateTail(outcome.stdout, this.#options.maxOutputBytes)
    const err = truncateTail(outcome.stderr, this.#options.maxOutputBytes)
    return {
      code: outcome.code,
      stdout: out.text,
      stderr: err.text,
      timedOut: outcome.timedOut,
      truncated: out.truncated || err.truncated,
    }
  }

  async #sudoPassword(
    target: SshTarget,
    prompter: TransportPrompter,
    retry: boolean,
    signal: AbortSignal,
  ): Promise<string> {
    void signal
    const stored = this.#options.secrets.get(this.#sessionId, target.name, "sudo")
    if (stored !== undefined && !retry) return stored
    const value = await prompter.secret(target, "sudo", { retry })
    this.#options.secrets.set(this.#sessionId, target.name, "sudo", value)
    return value
  }

  async #refreshPasswordlessSudo(target: SshTarget, signal: AbortSignal): Promise<boolean> {
    const state = this.#state(target)
    if (state.passwordlessSudo !== undefined) return state.passwordlessSudo
    const outcome = await this.#runRaw(target, "sudo -n true", signal)
    state.passwordlessSudo = outcome.code === 0
    return state.passwordlessSudo
  }

  async #runRaw(
    target: SshTarget,
    command: string,
    signal: AbortSignal,
  ): Promise<{ code: number | null }> {
    const state = this.#state(target)
    const outcome = await runProcess(
      buildExecArgv(this.#options.sshPath, target, state.controlPath, quoteCommand(command)),
      {
        env: { LC_ALL: "C" },
        signal,
        timeoutMs: 30_000,
      },
    )
    return { code: outcome.code }
  }

  #fileTimeout(): number {
    return 600_000
  }
}

async function closeShellChild(child: ChildProcess): Promise<void> {
  if (hasExited(child)) return
  child.kill("SIGTERM")
  if (await waitForExit(child, SHELL_CLOSE_WAIT_MS)) return
  child.kill("SIGKILL")
  if (await waitForExit(child, SHELL_CLOSE_KILL_WAIT_MS)) return
  throw new Error(
    `The ssh process of the interactive session did not exit (pid ${String(child.pid)}); the remote shell may still be open`,
  )
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (hasExited(child)) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      child.removeListener("exit", onExit)
      resolve(false)
    }, timeoutMs)
    timer.unref()
    const onExit = (): void => {
      clearTimeout(timer)
      resolve(true)
    }
    child.once("exit", onExit)
  })
}

async function socketReady(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function failureOf(
  setByAskpass: string | undefined,
  stderr: string,
): { kind: string; message: string } {
  if (setByAskpass !== undefined) {
    return {
      kind: setByAskpass.includes("changed")
        ? "REMOTE_HOST_KEY_CHANGED"
        : "REMOTE_HOST_KEY_REFUSED",
      message: setByAskpass,
    }
  }
  if (/permission denied|too many authentication failures|authentication failed/iu.test(stderr)) {
    return { kind: "auth", message: "SSH authentication failed" }
  }
  if (/host key verification failed/iu.test(stderr)) {
    return { kind: "REMOTE_HOST_KEY", message: "The remote host key was not accepted" }
  }
  if (/could not resolve hostname/iu.test(stderr)) {
    return { kind: "REMOTE_HOST_NOT_FOUND", message: "Could not resolve the remote host name" }
  }
  if (
    /connection refused|connection timed out|no route to host|network is unreachable/iu.test(stderr)
  ) {
    return { kind: "REMOTE_UNREACHABLE", message: "Could not reach the remote host" }
  }
  const detail = stderr.trim().split("\n").slice(-3).join(" ")
  return {
    kind: "REMOTE_CONNECT_FAILED",
    message: detail.length > 0 ? detail : "Could not open the SSH connection",
  }
}

function isMuxFailure(stderr: string): boolean {
  return /control socket|mux_client|broken pipe|connection reset/i.test(stderr)
}

function isSudoAuthFailure(outcome: CommandOutcome): boolean {
  return (
    outcome.code !== 0 &&
    /incorrect password|sorry, try again|no password was provided|a password is required/iu.test(
      outcome.stderr,
    )
  )
}

function fileError(message: string, outcome: CommandOutcome): SshConnectionError {
  const detail = outcome.timedOut
    ? "the command timed out"
    : outcome.stderr.trim() ||
      (outcome.code === null ? "the connection closed" : `exit code ${String(outcome.code)}`)
  return new SshConnectionError("REMOTE_FILE_FAILED", `${message}: ${detail}`)
}

function verifyContentHash(content: string, expected: string): boolean {
  return createHash("sha256").update(content, "utf8").digest("hex") === expected
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortError(signal)
  return await new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError(signal))
    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      },
    )
  })
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("The tool call was cancelled")
}
