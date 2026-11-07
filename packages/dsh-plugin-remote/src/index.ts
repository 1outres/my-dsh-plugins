import type { Context } from "@deepseek-ai/cordis"
import type {} from "@deepseek-ai/dsh-workspace"
import z from "@deepseek-ai/schemastery"
import { PromptBroker } from "./host/prompts/broker"
import { RemotePromptService } from "./host/prompts/service"
import { type HostRuntime, RootRuntimes, type RuntimeConfig } from "./host/runtime"
import { SecretStore } from "./host/secrets/store"
import { remoteTargetsProjection } from "./host/targets/projection"
import { registerTools } from "./host/tools/index"
import { AskpassServer } from "./host/transport/ssh/askpass-server"

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
})

/** Host half: tools, SSH connections, in-memory passwords, and the card bridge. */
export async function apply(ctx: Context, config: Config): Promise<void> {
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
  }
  const handle = await ctx.sessionProjections.register(remoteTargetsProjection)
  const askpass = await AskpassServer.create()
  const broker = new PromptBroker()
  const secrets = new SecretStore()
  let runtimes: RootRuntimes | undefined
  const host: HostRuntime = {
    config: resolved,
    handle,
    broker,
    secrets,
    askpass,
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

  ctx.on("session/disposed", (session) => {
    void host.disposeSession(session.id)
  })
  ctx.on("workspace/session-stop", ({ sessionId }) => host.disposeSession(sessionId))

  ctx.effect(
    () => async () => {
      broker.dispose()
      await host.disposeAll()
      await askpass.dispose()
    },
    "remote: connections and passwords",
  )
}
