import type { RemoteTarget, SerialTarget, TransportId } from "../../../shared/types"
import type { LoggerLike } from "../../logger"
import type { SerialAgents } from "../../serial/agents"
import type {
  ExecOptions,
  FileHashOutcome,
  FileReadOutcome,
  RemoteTransport,
  ShellHandle,
  TransportCall,
  TransportCapabilities,
} from "../transport"
import { SerialShell } from "./serial-shell"

export interface SerialTransportOptions {
  sessionId: string
  agents: SerialAgents
  replayBytes: number
  logger: LoggerLike
}

/** The serial transport of one root session. */
export class SerialTransport implements RemoteTransport {
  readonly id: TransportId = "serial"
  readonly #sessionId: string
  readonly #agents: SerialAgents
  readonly #replayBytes: number
  readonly #logger: LoggerLike
  readonly #shells = new Map<string, Set<SerialShell>>()

  constructor(options: SerialTransportOptions) {
    this.#sessionId = options.sessionId
    this.#agents = options.agents
    this.#replayBytes = options.replayBytes
    this.#logger = options.logger
  }

  capabilities(_target: RemoteTarget): TransportCapabilities {
    return {
      exec: false,
      sudo: false,
      files: false,
      jump: false,
      interactive: true,
      break: true,
    }
  }

  async connect(target: RemoteTarget, call: TransportCall): Promise<void> {
    const serial = serialTarget(target)
    const connection = this.#agents.requireConnection(serial.agent, serial.agentFingerprint)
    let ports: readonly { path: string }[]
    try {
      ports = (await connection.request("ports.list", {}, call.signal)).ports
    } catch (error) {
      throw new Error(
        `Could not list the serial ports of agent ${JSON.stringify(serial.agent)}: ${errorMessage(error)}`,
      )
    }
    if (!ports.some((port) => port.path === serial.device)) {
      throw new Error(
        `Serial device ${JSON.stringify(serial.device)} is not offered by agent ${JSON.stringify(serial.agent)}; call remote_serial_agents to list its ports`,
      )
    }
  }

  async disconnect(target: RemoteTarget, _sessionId: string): Promise<void> {
    await this.#closeShells(serialTarget(target).name)
  }

  async isConnected(target: RemoteTarget, _sessionId: string): Promise<boolean> {
    if (target.transport !== "serial") return false
    const connection = this.#agents.connection(target.agent)
    return connection !== undefined && connection.fingerprint === target.agentFingerprint
  }

  async exec(target: RemoteTarget, _options: ExecOptions, _call: TransportCall): Promise<never> {
    throw unsupported(target, "one-shot commands")
  }

  async readFile(
    target: RemoteTarget,
    _path: string,
    _sudo: boolean,
    _call: TransportCall,
  ): Promise<FileReadOutcome> {
    throw unsupported(target, "file reads")
  }

  async hashFile(
    target: RemoteTarget,
    _path: string,
    _sudo: boolean,
    _call: TransportCall,
  ): Promise<FileHashOutcome> {
    throw unsupported(target, "file hashes")
  }

  async writeFile(
    target: RemoteTarget,
    _path: string,
    _content: string,
    _expectedHash: string | null,
    _options: { sudo: boolean },
    _call: TransportCall,
  ): Promise<void> {
    throw unsupported(target, "file writes")
  }

  async openShell(target: RemoteTarget, call: TransportCall): Promise<ShellHandle> {
    const serial = serialTarget(target)
    const connection = this.#agents.requireConnection(serial.agent, serial.agentFingerprint)
    const lease = this.#agents.lease(serial.agent, serial.device, {
      sessionId: this.#sessionId,
      targetName: serial.name,
    })
    let shell: SerialShell | undefined
    try {
      const opened = await connection.request(
        "port.open",
        { path: serial.device, settings: serial.serial },
        call.signal,
      )
      const from = opened.reused
        ? Math.max(opened.start, opened.end - this.#replayBytes)
        : opened.end
      shell = new SerialShell({
        target: serial,
        connection,
        registry: this.#agents,
        handle: opened.handle,
        lease,
        logger: this.#logger,
        from,
      })
      const subscription = await connection.request(
        "port.subscribe",
        { handle: opened.handle, from },
        call.signal,
      )
      shell.resolveSubscription(subscription)
      this.#track(shell)
      return shell
    } catch (error) {
      shell?.kill()
      this.#agents.release(lease)
      throw error
    }
  }

  async disposeSession(): Promise<void> {
    const shells = [...this.#shells.values()].flatMap((set) => [...set])
    this.#shells.clear()
    await Promise.all(
      shells.map(async (shell) => {
        shell.kill()
        await shell.shutdown()
      }),
    )
  }

  #track(shell: SerialShell): void {
    let set = this.#shells.get(shell.targetName)
    if (set === undefined) {
      set = new Set()
      this.#shells.set(shell.targetName, set)
    }
    set.add(shell)
    shell.onExit(() => {
      set.delete(shell)
      if (set.size === 0) this.#shells.delete(shell.targetName)
    })
  }

  async #closeShells(targetName: string): Promise<void> {
    const set = this.#shells.get(targetName)
    if (set === undefined) return
    const shells = [...set]
    this.#shells.delete(targetName)
    await Promise.all(
      shells.map(async (shell) => {
        shell.kill()
        await shell.shutdown()
      }),
    )
  }
}

function serialTarget(target: RemoteTarget): SerialTarget {
  if (target.transport !== "serial") {
    throw new Error(
      `The serial transport cannot drive the ${target.transport} target ${JSON.stringify(target.name)}`,
    )
  }
  return target
}

function unsupported(target: RemoteTarget, feature: string): Error {
  return new Error(
    `Serial targets only support interactive sessions; target ${JSON.stringify(target.name)} cannot do ${feature}. Use remote_session_open`,
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
