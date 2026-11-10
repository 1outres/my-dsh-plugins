import type { AgentConnection } from "./agent-connection"
import type { SerialAgentKey } from "./identity"
import { SERIAL_CLOSE } from "./protocol"

/** One agent key the user authorized in the plugin config. */
export interface AuthorizedSerialAgent {
  name: string
  key: SerialAgentKey
}

/** What the serial tools report about one authorized agent. */
export interface SerialAgentEntry {
  name: string
  fingerprint: string
  online: boolean
  connection?: AgentConnection
}

/** One root session's claim on one port of one agent. */
export interface SerialPortLease {
  agent: string
  path: string
  sessionId: string
  targetName: string
}

export interface SerialAgentChange {
  name: string
  connection: AgentConnection | undefined
}

/** The host-wide serial agents and their port leases. */
export class SerialAgents {
  readonly #authorized: AuthorizedSerialAgent[]
  readonly #byName = new Map<string, AuthorizedSerialAgent>()
  readonly #byPublicKey = new Map<string, AuthorizedSerialAgent>()
  readonly #live = new Map<string, AgentConnection>()
  readonly #leases = new Map<string, SerialPortLease>()
  readonly #listeners = new Set<(change: SerialAgentChange) => void>()

  constructor(authorized: readonly AuthorizedSerialAgent[]) {
    this.#authorized = [...authorized]
    for (const agent of this.#authorized) {
      this.#byName.set(agent.name, agent)
      this.#byPublicKey.set(agent.key.publicKey, agent)
    }
  }

  authorization(name: string): AuthorizedSerialAgent | undefined {
    return this.#byName.get(name)
  }

  findByPublicKey(publicKey: string): AuthorizedSerialAgent | undefined {
    return this.#byPublicKey.get(publicKey)
  }

  connection(name: string): AgentConnection | undefined {
    return this.#live.get(name)
  }

  online(name: string): boolean {
    return this.#live.has(name)
  }

  /**
   * The live connection for one target, or a clear reason it cannot be used.
   * The fingerprint check catches an agent key that changed after registration.
   */
  requireConnection(name: string, fingerprint: string): AgentConnection {
    if (this.#byName.get(name) === undefined) {
      throw new Error(
        `Serial agent ${JSON.stringify(name)} is not in the serialAgents config; add its key or remove this target`,
      )
    }
    const connection = this.#live.get(name)
    if (connection === undefined) {
      throw new Error(
        `Serial agent ${JSON.stringify(name)} is offline; the port stays open on the agent and the session continues when it reconnects`,
      )
    }
    if (connection.fingerprint !== fingerprint) {
      throw new Error(
        `The key of serial agent ${JSON.stringify(name)} changed since this target was registered; remove the target and add it again`,
      )
    }
    return connection
  }

  statusOf(name: string): SerialAgentEntry | undefined {
    const authorized = this.#byName.get(name)
    if (authorized === undefined) return undefined
    return this.#entry(authorized)
  }

  list(): SerialAgentEntry[] {
    return this.#authorized.map((agent) => this.#entry(agent))
  }

  onChange(listener: (change: SerialAgentChange) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** Accept one authenticated connection; a newer one replaces the old one. */
  attach(connection: AgentConnection): void {
    const authorized = this.#byName.get(connection.name)
    if (authorized === undefined) {
      throw new Error(
        `Serial agent ${JSON.stringify(connection.name)} is not authorized in serialAgents`,
      )
    }
    if (authorized.key.fingerprint !== connection.fingerprint) {
      throw new Error(
        `Serial agent ${JSON.stringify(connection.name)} connected with an unauthorized key`,
      )
    }
    const current = this.#live.get(connection.name)
    if (current === connection) return
    this.#live.set(connection.name, connection)
    connection.onClose(() => {
      if (this.#live.get(connection.name) !== connection) return
      this.#live.delete(connection.name)
      this.#emit({ name: connection.name, connection: undefined })
    })
    if (current !== undefined) current.close(SERIAL_CLOSE.replaced, "replaced")
    this.#emit({ name: connection.name, connection })
  }

  lease(
    agent: string,
    path: string,
    owner: { sessionId: string; targetName: string },
  ): SerialPortLease {
    const key = leaseKey(agent, path)
    const current = this.#leases.get(key)
    if (current !== undefined) {
      const holder =
        current.sessionId === owner.sessionId
          ? `target ${JSON.stringify(current.targetName)} in this session`
          : `another session (target ${JSON.stringify(current.targetName)})`
      throw new Error(
        `The serial port ${path} on agent ${JSON.stringify(agent)} is already used by ${holder}`,
      )
    }
    const lease: SerialPortLease = {
      agent,
      path,
      sessionId: owner.sessionId,
      targetName: owner.targetName,
    }
    this.#leases.set(key, lease)
    return lease
  }

  release(lease: SerialPortLease): void {
    const key = leaseKey(lease.agent, lease.path)
    if (this.#leases.get(key) === lease) this.#leases.delete(key)
  }

  leaseOf(agent: string, path: string): SerialPortLease | undefined {
    return this.#leases.get(leaseKey(agent, path))
  }

  /** Drop every live socket without sending port.close, so the agent keeps its ports. */
  closeAll(): void {
    const live = [...this.#live.entries()]
    this.#live.clear()
    for (const [name, connection] of live) {
      this.#emit({ name, connection: undefined })
      connection.close(SERIAL_CLOSE.normal, "harness shutdown")
    }
  }

  #emit(change: SerialAgentChange): void {
    for (const listener of [...this.#listeners]) listener(change)
  }

  #entry(agent: AuthorizedSerialAgent): SerialAgentEntry {
    const connection = this.#live.get(agent.name)
    return {
      name: agent.name,
      fingerprint: agent.key.fingerprint,
      online: connection !== undefined,
      ...(connection === undefined ? {} : { connection }),
    }
  }
}

function leaseKey(agent: string, path: string): string {
  return `${agent}\u0000${path}`
}
