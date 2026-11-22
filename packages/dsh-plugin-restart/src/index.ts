import type { Context } from "@deepseek-ai/cordis"
import type { Agent } from "@deepseek-ai/dsh-agent"
import { SessionId } from "@deepseek-ai/dsh-session"
import type {} from "@deepseek-ai/dsh-subagent"
import { Config, type Config as PluginConfig, resolveConfig } from "./config"
import type {
  AgentPort,
  LoggerPort,
  PresetId,
  ResolvedSession,
  ResumeSessionPort,
  ResumeTable,
} from "./contract"
import { RestartCoordinator } from "./host/coordinator"
import { RESTART_RESUME_DOMAIN } from "./host/domain"
import { createRestartMessage } from "./host/message"
import { resumeAfterStartup } from "./host/resume"
import { startAfterStartup } from "./host/startup"
import { createResumeStore } from "./host/store"
import { registerRestartTool } from "./host/tool"
import { armExitWatchdog } from "./host/watchdog"

export const name = "restart"

/** The Host services this plugin reads. */
export const inject = ["tools", "agents", "agentPresets", "subagents", "storageDomain"]

export { Config }

/** Preset lookup of the agent-preset registry. */
interface PresetRegistryLike {
  composedPreset(agentContext: Context): PresetId | undefined
}

interface ResumeDomain {
  table(name: "requests"): ResumeTable
  close(): Promise<void>
}

interface StorageDomainLike {
  open(spec: typeof RESTART_RESUME_DOMAIN): Promise<ResumeDomain>
}

interface SessionTitleLike {
  get(session: Agent["session"]): { title: string } | undefined
}

interface SessionControllerLike {
  resolveAgent(sessionId: SessionId): Promise<{ agent: Agent } | { error: { message: string } }>
}

type AppExitLike = (code: number) => void

interface AppReadyLike {
  onReady(listener: () => void): () => void
}

/** The required services whose packages this plugin does not depend on. */
interface HostServices {
  readonly agentPresets: PresetRegistryLike
  readonly storageDomain: StorageDomainLike
}

/** The plugin context of the `sessionController` injection. */
interface WebServices {
  readonly sessionController: SessionControllerLike
}

/**
 * Read one optional Host service. The launcher and the Web app provide these,
 * so a profile without them must still load this plugin.
 * @param ctx - Host context.
 * @param name - Cordis service name.
 * @returns the service, or undefined when nothing provides it.
 */
function serviceOf<T>(ctx: Context, name: string): T | undefined {
  const store = ctx as unknown as { get(service: string): unknown }
  return store.get(name) as T | undefined
}

/**
 * Host half: offers `restart_harness` to Creator sessions and resumes the
 * calling session after the process comes back.
 * @param ctx - Host context.
 * @param config - Creator presets, exit code, and shutdown timing.
 */
export async function apply(ctx: Context, config: PluginConfig): Promise<void> {
  const resolved = resolveConfig(config)
  const services = ctx as unknown as HostServices
  const logger: LoggerPort = {
    info: (message) => ctx.logger.info(`restart: ${message}`),
    warn: (message) => ctx.logger.warn(`restart: ${message}`),
  }

  const appExit = serviceOf<AppExitLike>(ctx, "appExit")
  const appReady = serviceOf<AppReadyLike>(ctx, "appReady")
  if (appExit === undefined) {
    logger.warn("the launcher provides no appExit; restart_harness is not offered")
  }

  const domain = await services.storageDomain.open(RESTART_RESUME_DOMAIN)
  ctx.effect(() => () => domain.close(), "restart: storage domain")

  const titleOf = (agent: Agent): string | undefined =>
    serviceOf<SessionTitleLike>(ctx, "sessionTitle")?.get(agent.session)?.title

  const agentOf = (agent: Agent): AgentPort => ({
    id: agent.id,
    sessionId: agent.session.id,
    title: titleOf(agent),
    status: () => agent.status,
    whenIdle: () => agent.whenIdle(),
    followup: (text) => {
      agent.followup(createRestartMessage(text))
    },
  })

  const store = createResumeStore(domain.table("requests"))
  const coordinator = new RestartCoordinator({
    agents: { list: () => ctx.agents.list().map(agentOf) },
    store,
    launcher: {
      exit(code) {
        if (appExit === undefined) throw new Error("restart: the launcher provides no appExit")
        appExit(code)
      },
    },
    watchdog: {
      arm: () =>
        armExitWatchdog((code) => process.exit(code), resolved.exitCode, resolved.forceExitAfterMs),
    },
    clock: Date.now,
    logger,
    exitCode: resolved.exitCode,
  })

  registerRestartTool(ctx, {
    presets: resolved.presets,
    coordinator,
    canExit: () => appExit !== undefined,
    factsOf: (agent) => ({
      agentId: agent.id,
      rootAgentId: ctx.subagents.rootOf(agent).id,
      preset: services.agentPresets.composedPreset(agent.ctx),
    }),
    agentOf,
  })

  ctx.on("agent/disposed", ({ agent }) => {
    coordinator.onAgentDisposed(agent.id)
  })

  startAfterStartup({
    onReady: (listener) => {
      if (appReady === undefined) {
        listener()
        return
      }
      ctx.effect(() => {
        const cancel = appReady.onReady(listener)
        return () => {
          cancel()
        }
      }, "restart: startup")
    },
    onSessions: (listener) => {
      ctx.inject(["sessionController"], (webCtx) => {
        const web = webCtx as unknown as WebServices
        listener(sessionPort(web.sessionController))
      })
    },
    run: async (sessions) => {
      await resumeAfterStartup({
        store,
        sessions,
        clock: Date.now,
        withinMinutes: resolved.resumeWithinMinutes,
        logger,
      })
    },
    logger,
  })
}

function sessionPort(controller: SessionControllerLike): ResumeSessionPort {
  return {
    async resolve(sessionId: string): Promise<ResolvedSession> {
      const resolved = await controller.resolveAgent(SessionId(sessionId))
      if ("error" in resolved) return { kind: "missing", reason: resolved.error.message }
      const agent = resolved.agent
      return {
        kind: "found",
        deliver: {
          followup: (text) => {
            agent.followup(createRestartMessage(text))
          },
        },
      }
    },
  }
}
