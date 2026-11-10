import type { Context } from "@deepseek-ai/cordis"
import type {} from "@deepseek-ai/dsh-host-webserver"
import type {} from "@deepseek-ai/dsh-workspace"
import z from "@deepseek-ai/schemastery"
import { PromptBroker } from "./host/prompts/broker"
import { RemotePromptService } from "./host/prompts/service"
import { type HostRuntime, RootRuntimes, type RuntimeConfig } from "./host/runtime"
import { SecretStore } from "./host/secrets/store"
import { type AuthorizedSerialAgent, SerialAgents } from "./host/serial/agents"
import { SerialGateway } from "./host/serial/gateway"
import { parseAgentPublicKey, type SerialAgentKey } from "./host/serial/identity"
import { remoteTargetsProjection } from "./host/targets/projection"
import { registerTools } from "./host/tools/index"
import { AskpassServer } from "./host/transport/ssh/askpass-server"
import { isValidTargetName } from "./shared/target"

export const name = "remote"

export const inject = ["tools", "sessionProjections", "agents"]

export interface Config {
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
  serialAgents: Array<{ name: string; publicKey: string }>
  serialGatewayPath: string
  serialRequestTimeoutMs: number
  serialReplayBytes: number
}

export const Config = z.object({
  sshPath: z.string().default("ssh").description("The ssh command to run."),
  controlPersistSeconds: z
    .number()
    .step(1)
    .min(0)
    .max(86400)
    .default(600)
    .description("Seconds an unused ControlMaster stays open."),
  execTimeoutMs: z
    .number()
    .step(1)
    .min(1)
    .default(120000)
    .description("Default timeout of remote_exec in milliseconds."),
  execMaxTimeoutMs: z
    .number()
    .step(1)
    .min(1)
    .default(600000)
    .description("Largest timeout remote_exec accepts in milliseconds."),
  maxOutputBytes: z
    .number()
    .step(1)
    .min(1024)
    .default(30000)
    .description("Bytes of tool output kept; the tail is kept."),
  blockedSshOptions: z
    .array(z.string())
    .default(["ProxyCommand", "LocalCommand", "PermitLocalCommand", "KnownHostsCommand", "Match"])
    .description("ssh -o option names the model may not set."),
  defaultPromptPattern: z
    .string()
    .default("[>#$%]\\s*$")
    .description("Default regular expression for an interactive prompt."),
  sessionIdleMs: z
    .number()
    .step(1)
    .min(100)
    .default(2000)
    .description("Silence that ends a wait for interactive output, in milliseconds."),
  sessionSendTimeoutMs: z
    .number()
    .step(1)
    .min(1)
    .default(30000)
    .description("Default wait for remote_session_send in milliseconds."),
  maxSecretRetries: z
    .number()
    .step(1)
    .min(0)
    .max(10)
    .default(2)
    .description("Times a refused password is asked for again."),
  serialAgents: z
    .array(
      z.object({
        name: z.string(),
        publicKey: z.string(),
      }),
    )
    .default([])
    .description(
      'Authorized dsh-serial-agent keys. Add the JSON line that "dsh-serial-agent pubkey" prints under "config:", for example - {"name":"lab-mac","publicKey":"..."}.',
    ),
  serialGatewayPath: z
    .string()
    .default("/remote-serial/agent")
    .description("Path where dsh-serial-agent opens its WebSocket."),
  serialRequestTimeoutMs: z
    .number()
    .step(1)
    .min(1000)
    .default(10000)
    .description("Milliseconds before a request to a serial agent fails."),
  serialReplayBytes: z
    .number()
    .step(1)
    .min(0)
    .default(4096)
    .description("Bytes of earlier console output shown when a session attaches to an open port."),
})

/** Host half: tools, SSH and serial connections, in-memory passwords, and the card bridge. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  if (!config.serialGatewayPath.startsWith("/")) {
    throw new Error('serialGatewayPath must start with "/"')
  }
  const authorized = authorizeSerialAgents(config.serialAgents)
  const serial = new SerialAgents(authorized)
  const gateway = new SerialGateway(serial, {
    path: config.serialGatewayPath,
    requestTimeoutMs: config.serialRequestTimeoutMs,
  })
  const resolved: RuntimeConfig = {
    sshPath: config.sshPath,
    controlPersistSeconds: config.controlPersistSeconds,
    execTimeoutMs: Math.min(config.execTimeoutMs, config.execMaxTimeoutMs),
    execMaxTimeoutMs: config.execMaxTimeoutMs,
    maxOutputBytes: config.maxOutputBytes,
    blockedSshOptions: [...config.blockedSshOptions],
    defaultPromptPattern: config.defaultPromptPattern,
    sessionIdleMs: config.sessionIdleMs,
    sessionSendTimeoutMs: Math.min(config.sessionSendTimeoutMs, config.execMaxTimeoutMs),
    maxSecretRetries: config.maxSecretRetries,
    serialReplayBytes: config.serialReplayBytes,
  }
  const handle = await ctx.sessionProjections.register(remoteTargetsProjection)
  const askpass = await AskpassServer.create()
  const broker = new PromptBroker()
  const secrets = new SecretStore()
  let runtimes: RootRuntimes | undefined
  const host: HostRuntime = {
    config: resolved,
    handle,
    logger: { warn: (message) => ctx.logger.warn(message) },
    broker,
    secrets,
    askpass,
    serial,
    runtimeFor: (agent) => {
      if (runtimes === undefined) throw new Error("The remote plugin is still starting")
      return runtimes.get(agent)
    },
    disposeSession: async (sessionId) => {
      if (runtimes === undefined) return
      await runtimes.disposeSession(sessionId)
    },
    disposeAll: async () => {
      if (runtimes === undefined) return
      await runtimes.disposeAll()
    },
  }
  runtimes = new RootRuntimes(host)
  new RemotePromptService(ctx, broker)
  registerTools(ctx, host)
  ctx.inject(["webServer"], (webCtx) => {
    webCtx.effect(() => gateway.attach(webCtx.webServer), "remote: serial agent gateway")
  })

  ctx.on("session/disposed", (session) => {
    void host.disposeSession(session.id)
  })
  ctx.on("workspace/session-stop", ({ sessionId }) => host.disposeSession(sessionId))

  ctx.effect(
    () => async () => {
      broker.dispose()
      serial.closeAll()
      await host.disposeAll()
      gateway.dispose()
      await askpass.dispose()
    },
    "remote: connections and passwords",
  )
}

/** Validate the agent keys once at load; a bad entry fails the whole plugin. */
function authorizeSerialAgents(
  entries: readonly { name: string; publicKey: string }[],
): AuthorizedSerialAgent[] {
  const names = new Set<string>()
  const fingerprints = new Set<string>()
  return entries.map((entry) => {
    if (!isValidTargetName(entry.name)) {
      throw new Error(
        `serialAgents: ${JSON.stringify(entry.name)} is not a valid agent name; use 1 to 32 lowercase letters, digits, or hyphens`,
      )
    }
    if (names.has(entry.name)) {
      throw new Error(
        `serialAgents: the name ${JSON.stringify(entry.name)} is given more than once`,
      )
    }
    names.add(entry.name)
    let key: SerialAgentKey
    try {
      key = parseAgentPublicKey(entry.publicKey)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(
        `serialAgents: the publicKey of ${JSON.stringify(entry.name)} is invalid: ${detail}`,
      )
    }
    if (fingerprints.has(key.fingerprint)) {
      throw new Error(
        `serialAgents: the key of ${JSON.stringify(entry.name)} is given more than once`,
      )
    }
    fingerprints.add(key.fingerprint)
    return { name: entry.name, key }
  })
}
