import type { Context } from "@deepseek-ai/cordis"
import type { Agent } from "@deepseek-ai/dsh-agent"
import type { ProjectionHandle } from "@deepseek-ai/dsh-session-projection"
import type {
  RemotePromptAnswer,
  RemotePromptRequest,
  RemoteTarget,
  RemoteTargetsView,
} from "../shared/types"
import type { LoggerLike } from "./logger"
import type { PromptBroker } from "./prompts/broker"
import { secretFieldLabel } from "./prompts/labels"
import type { SecretStore } from "./secrets/store"
import type { SerialAgents } from "./serial/agents"
import { InteractiveSessions } from "./sessions/session"
import { SerialTransport } from "./transport/serial/serial-transport"
import { type SshConnectionOptions, SshConnections } from "./transport/ssh/connection"
import { SshTransport } from "./transport/ssh/ssh-transport"
import type { RemoteTransport, TransportCall, TransportPrompter } from "./transport/transport"

export interface RuntimeConfig {
  sshPath: string
  controlPersistSeconds: number
  execTimeoutMs: number
  execMaxTimeoutMs: number
  maxOutputBytes: number
  blockedSshOptions: string[]
  defaultPromptPattern: string
  sessionIdleMs: number
  sessionSendTimeoutMs: number
  maxSecretRetries: number
  serialReplayBytes: number
}

const MAX_FILE_BYTES = 64_000_000

/** Walk live runtime ownership up to the top-level agent. */
export function resolveRootAgent(ctx: Context, agent: Agent): Agent {
  let current = agent
  const seen = new Set<string>()
  for (;;) {
    if (seen.has(current.id)) return current
    seen.add(current.id)
    const owner = ctx.agents
      .list()
      .find(
        (candidate) => candidate.id !== current.id && ctx.agents.isOwnedBy(current.id, candidate),
      )
    if (owner === undefined) return current
    current = owner
  }
}

export class CallPrompter implements TransportPrompter {
  readonly #broker: PromptBroker
  readonly #secrets: SecretStore
  readonly #sessionId: string
  readonly #callId: string
  readonly #signal: AbortSignal
  readonly #allowUserCards: boolean

  constructor(
    broker: PromptBroker,
    secrets: SecretStore,
    sessionId: string,
    callId: string,
    signal: AbortSignal,
    allowUserCards: boolean,
  ) {
    this.#broker = broker
    this.#secrets = secrets
    this.#sessionId = sessionId
    this.#callId = callId
    this.#signal = signal
    this.#allowUserCards = allowUserCards
  }

  async secret(
    target: RemoteTarget,
    field: string,
    options: { label?: string; retry?: boolean },
  ): Promise<string> {
    const stored = this.#secrets.get(this.#sessionId, target.name, field)
    if (stored !== undefined && options.retry !== true) return stored
    const answer = await this.#ask({
      kind: "secret",
      title: "",
      ...(options.label === undefined ? {} : { detail: options.label }),
      target,
      fields: [{ name: field, label: secretFieldLabel(field, options.label), masked: true }],
      retry: options.retry === true,
    })
    if (answer.decision !== "submit")
      throw new Error(answer.reason ?? "The user cancelled the password input")
    const value = answer.values?.[field]
    if (value === undefined || value.length === 0)
      throw new Error("The user submitted an empty value")
    this.#secrets.set(this.#sessionId, target.name, field, value)
    return value
  }

  async hostKey(
    target: RemoteTarget,
    hostKey: { host: string; algorithm: string; fingerprint: string } | undefined,
  ): Promise<boolean> {
    const answer = await this.#ask({
      kind: "hostkey",
      title: "",
      target,
      hostKey: hostKey ?? {
        host: target.transport === "ssh" ? target.host : target.name,
        algorithm: "",
        fingerprint: "",
      },
      fields: [],
    })
    return answer.decision === "approve"
  }

  async askRegistration(target: RemoteTarget, fields: string[]): Promise<Record<string, string>> {
    const answer = await this.#ask({
      kind: "register",
      title: "",
      target,
      fields: fields.map((name) => ({ name, label: secretFieldLabel(name), masked: true })),
    })
    if (answer.decision !== "approve")
      throw new Error(answer.reason ?? "The user rejected the target registration")
    return answer.values ?? {}
  }

  async #ask(
    input: Omit<RemotePromptRequest, "id" | "sessionId" | "callId">,
  ): Promise<RemotePromptAnswer> {
    if (!this.#allowUserCards) {
      throw new Error(
        "A sub-agent cannot ask the user for approval or a password; ask the root session to do it",
      )
    }
    return await this.#broker.ask(
      { ...input, sessionId: this.#sessionId, callId: this.#callId },
      this.#signal,
    )
  }
}

/** One root session's connections, interactive shells, and secret values. */
export class RootRuntime {
  readonly root: Agent
  readonly sessionId: string
  readonly connections: SshConnections
  readonly sshTransport: SshTransport
  readonly serialTransport: SerialTransport
  readonly sessions: InteractiveSessions
  readonly readHashes = new Map<string, string>()
  readonly #host: HostRuntime
  readonly #connectionOptions: SshConnectionOptions

  constructor(host: HostRuntime, root: Agent) {
    this.#host = host
    this.root = root
    this.sessionId = root.id
    const config = host.config
    this.#connectionOptions = {
      sshPath: config.sshPath,
      persistSeconds: config.controlPersistSeconds,
      maxSecretRetries: config.maxSecretRetries,
      maxOutputBytes: config.maxOutputBytes,
      maxFileBytes: MAX_FILE_BYTES,
      askpass: host.askpass,
      secrets: host.secrets,
    }
    this.connections = new SshConnections(
      this.sessionId,
      (name) => this.find(name),
      this.#connectionOptions,
    )
    this.sshTransport = new SshTransport(this.connections)
    this.serialTransport = new SerialTransport({
      sessionId: this.sessionId,
      agents: host.serial,
      replayBytes: config.serialReplayBytes,
      logger: host.logger,
    })
    this.sessions = new InteractiveSessions((target) => this.transportFor(target), {
      defaultPromptPattern: config.defaultPromptPattern,
      idleMs: config.sessionIdleMs,
      sendTimeoutMs: config.sessionSendTimeoutMs,
      maxOutputBytes: config.maxOutputBytes,
      secretValues: () => this.secretValues(),
    })
  }

  transportFor(target: RemoteTarget): RemoteTransport {
    return target.transport === "ssh" ? this.sshTransport : this.serialTransport
  }

  targets(): RemoteTarget[] {
    return this.#host.handle.stateOf(this.root.session).targets
  }

  find(name: string): RemoteTarget | undefined {
    return this.targets().find((target) => target.name === name)
  }

  requireTarget(name: string): RemoteTarget {
    const target = this.find(name)
    if (target === undefined)
      throw new Error(`No remote target is named ${JSON.stringify(name)}; call remote_target_list`)
    return target
  }

  readKey(target: RemoteTarget, path: string, sudo: boolean): string {
    return `${target.name}\u0000${sudo ? "sudo" : "user"}\u0000${path}`
  }

  call(callId: string, signal: AbortSignal, allowUserCards = true): TransportCall {
    return {
      sessionId: this.sessionId,
      callId,
      signal,
      prompter: new CallPrompter(
        this.#host.broker,
        this.#host.secrets,
        this.sessionId,
        callId,
        signal,
        allowUserCards,
      ),
    }
  }

  prompter(callId: string, signal: AbortSignal, allowUserCards = true): CallPrompter {
    return new CallPrompter(
      this.#host.broker,
      this.#host.secrets,
      this.sessionId,
      callId,
      signal,
      allowUserCards,
    )
  }

  secretValues(): string[] {
    const values = new Set<string>()
    for (const target of this.targets()) {
      for (const field of [...target.secrets, "login", "sudo", "passphrase", "enable"]) {
        const value = this.#host.secrets.get(this.sessionId, target.name, field)
        if (value !== undefined) values.add(value)
      }
    }
    return [...values]
  }

  /** Stop interactive shells and drop the ControlMasters of this root session. */
  async dispose(): Promise<void> {
    this.sessions.dispose()
    this.#host.secrets.deleteSession(this.sessionId)
    await this.connections.disposeSession()
    await this.serialTransport.disposeSession()
  }
}

export interface HostRuntime {
  readonly config: RuntimeConfig
  readonly handle: ProjectionHandle<RemoteTargetsView>
  readonly logger: LoggerLike
  readonly broker: PromptBroker
  readonly secrets: SecretStore
  readonly askpass: import("./transport/ssh/askpass-server").AskpassServer
  readonly serial: SerialAgents
  runtimeFor(agent: Agent): RootRuntime
  disposeSession(sessionId: string): Promise<void>
  disposeAll(): Promise<void>
}

/** Creates and disposes one root runtime per live top-level session. */
export class RootRuntimes {
  readonly #host: HostRuntime
  readonly #runtimes = new Map<string, RootRuntime>()

  constructor(host: HostRuntime) {
    this.#host = host
  }

  get(root: Agent): RootRuntime {
    let runtime = this.#runtimes.get(root.id)
    if (runtime === undefined) {
      runtime = new RootRuntime(this.#host, root)
      this.#runtimes.set(root.id, runtime)
    }
    return runtime
  }

  async disposeSession(sessionId: string): Promise<void> {
    const runtime = this.#runtimes.get(sessionId)
    if (runtime === undefined) return
    this.#runtimes.delete(sessionId)
    await runtime.dispose()
  }

  async disposeAll(): Promise<void> {
    const runtimes = [...this.#runtimes.values()]
    this.#runtimes.clear()
    await Promise.all(runtimes.map(async (runtime) => runtime.dispose()))
  }
}
