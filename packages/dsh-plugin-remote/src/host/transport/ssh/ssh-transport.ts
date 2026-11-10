import type { RemoteTarget, SshTarget, TransportId } from "../../../shared/types"
import type {
  ExecOptions,
  FileHashOutcome,
  FileReadOutcome,
  RemoteTransport,
  ShellHandle,
  TransportCall,
  TransportCapabilities,
} from "../transport"
import type { SshConnections } from "./connection"

/** The SSH transport. It owns no targets; one instance serves one root session. */
export class SshTransport implements RemoteTransport {
  readonly id: TransportId = "ssh"
  readonly #connections: SshConnections

  constructor(connections: SshConnections) {
    this.#connections = connections
  }

  capabilities(target: RemoteTarget): TransportCapabilities {
    return {
      exec: true,
      sudo: target.kind === "linux",
      files: target.kind === "linux",
      jump: true,
      interactive: true,
      break: false,
    }
  }

  async connect(target: RemoteTarget, call: TransportCall): Promise<void> {
    await this.#connections.connect(sshTarget(target), call.prompter, call.signal)
  }

  async disconnect(target: RemoteTarget, _sessionId: string): Promise<void> {
    await this.#connections.disconnect(sshTarget(target).name)
  }

  async isConnected(target: RemoteTarget, _sessionId: string): Promise<boolean> {
    return await this.#connections.isConnected(sshTarget(target), AbortSignal.timeout(5000))
  }

  async exec(target: RemoteTarget, options: ExecOptions, call: TransportCall) {
    return await this.#connections.exec(
      sshTarget(target),
      options.command,
      options.stdin,
      options.sudo,
      options.timeoutMs,
      call.prompter,
      call.signal,
    )
  }

  async readFile(
    target: RemoteTarget,
    path: string,
    sudo: boolean,
    call: TransportCall,
  ): Promise<FileReadOutcome> {
    return await this.#connections.readFile(
      sshTarget(target),
      path,
      sudo,
      call.prompter,
      call.signal,
    )
  }

  async hashFile(
    target: RemoteTarget,
    path: string,
    sudo: boolean,
    call: TransportCall,
  ): Promise<FileHashOutcome> {
    return await this.#connections.hashFile(
      sshTarget(target),
      path,
      sudo,
      call.prompter,
      call.signal,
    )
  }

  async writeFile(
    target: RemoteTarget,
    path: string,
    content: string,
    expectedHash: string | null,
    options: { sudo: boolean },
    call: TransportCall,
  ): Promise<void> {
    await this.#connections.writeFile(
      sshTarget(target),
      path,
      content,
      expectedHash,
      options.sudo,
      call.prompter,
      call.signal,
    )
  }

  async openShell(target: RemoteTarget, call: TransportCall): Promise<ShellHandle> {
    return await this.#connections.openShell(sshTarget(target), call.prompter, call.signal)
  }

  async disposeSession(): Promise<void> {
    await this.#connections.disposeSession()
  }
}

function sshTarget(target: RemoteTarget): SshTarget {
  if (target.transport !== "ssh") {
    throw new Error(
      `The ssh transport cannot drive the ${target.transport} target ${JSON.stringify(target.name)}`,
    )
  }
  return target
}
