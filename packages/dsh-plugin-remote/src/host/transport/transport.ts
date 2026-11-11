import type { ExecResult, RemoteHostKey, RemoteTarget, TransportId } from "../../shared/types"

export interface TransportCapabilities {
  exec: boolean
  sudo: boolean
  files: boolean
  jump: boolean
  interactive: boolean
  /** Whether an interactive session can send a line BREAK. */
  break: boolean
}

/** One tool call's identity, cancellation, and card channel. */
export interface TransportCall {
  sessionId: string
  callId: string
  signal: AbortSignal
  prompter: TransportPrompter
}

export interface TransportPrompter {
  /** Ask for one secret field and return its value. */
  secret(target: RemoteTarget, field: string, options: SecretPromptOptions): Promise<string>
  /** Ask whether to accept one host key. */
  hostKey(target: RemoteTarget, hostKey: RemoteHostKey | undefined): Promise<boolean>
}

export interface SecretPromptOptions {
  /** Human wording for a keyboard-interactive prompt the plugin does not know. */
  label?: string
  /** True when the last value was refused, so the card asks again. */
  retry?: boolean
}

export interface FileReadOutcome {
  exists: boolean
  hash: string
  content: string
}

export interface FileHashOutcome {
  exists: boolean
  hash: string
}

export interface FileWriteOptions {
  sudo: boolean
}

export interface ExecOptions {
  command: string
  stdin?: string
  sudo: boolean
  timeoutMs: number
}

export interface ShellHandle {
  readonly pid: number | undefined
  /** The bytes one Enter key sends, such as "\n" for a PTY or "\r" for a serial console. */
  readonly enter: string
  /** Resolves once the transport accepted the data; rejects when it cannot deliver it. */
  write(data: string): Promise<void>
  /** Send a line BREAK. Only called when the transport capability `break` is true. */
  sendBreak(durationMs: number): Promise<void>
  onData(listener: (chunk: string) => void): () => void
  onExit(listener: (code: number | null) => void): () => void
  readonly exitCode: number | null
  /**
   * Release the shell and wait until the transport has fully let it go.
   * For ssh that means the child process has exited; for a serial console the
   * port is unsubscribed and closed and its lease is free again.
   * Rejects with an Error that says what could not be released.
   */
  close(): Promise<void>
  /**
   * Start the same release without waiting. Failures are logged. Use this
   * when there is nowhere to report them, such as while the plugin unloads.
   */
  kill(): void
}

/** One connection method: SSH or a serial port behind a dsh-serial-agent. */
export interface RemoteTransport {
  readonly id: TransportId
  capabilities(target: RemoteTarget): TransportCapabilities
  connect(target: RemoteTarget, call: TransportCall): Promise<void>
  disconnect(target: RemoteTarget, sessionId: string): Promise<void>
  isConnected(target: RemoteTarget, sessionId: string): Promise<boolean>
  exec(target: RemoteTarget, options: ExecOptions, call: TransportCall): Promise<ExecResult>
  readFile(
    target: RemoteTarget,
    path: string,
    sudo: boolean,
    call: TransportCall,
  ): Promise<FileReadOutcome>
  hashFile(
    target: RemoteTarget,
    path: string,
    sudo: boolean,
    call: TransportCall,
  ): Promise<FileHashOutcome>
  writeFile(
    target: RemoteTarget,
    path: string,
    content: string,
    expectedHash: string | null,
    options: FileWriteOptions,
    call: TransportCall,
  ): Promise<void>
  openShell(target: RemoteTarget, call: TransportCall): Promise<ShellHandle>
  disposeSession(sessionId: string): Promise<void>
}
