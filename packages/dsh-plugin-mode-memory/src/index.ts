import type { Context } from "@deepseek-ai/cordis"
import type { LoggerPort, MemoryTable, PresetRosterEntry } from "./contract"
import { MODE_MEMORY_DOMAIN } from "./host/domain"
import { installCreateHook } from "./host/hook"
import { ModeMemory } from "./host/memory"
import { createCreateScope } from "./host/scope"
import { createModeMemoryStore } from "./host/store"

export const name = "mode-memory"

/** The Host services this plugin reads. */
export const inject = [
  "sessionController",
  "agentPresets",
  "storageDomain",
  "sessions",
  "workspaceRegistry",
]

interface MemoryDomain {
  table(name: "projects"): MemoryTable
  close(): Promise<void>
}

interface StorageDomainLike {
  open(spec: typeof MODE_MEMORY_DOMAIN): Promise<MemoryDomain>
}

interface PresetRosterLike {
  list(): Promise<readonly PresetRosterEntry[]>
}

interface WorkspaceRegistryLike {
  get(workspaceId: string): { path: string } | undefined
}

interface SessionLike {
  readonly header: { cwd?: string; origin?: "subagent" }
}

interface SessionsLike {
  get(sessionId: string): SessionLike | undefined
}

interface HostServices {
  readonly sessionController: object
  readonly agentPresets: PresetRosterLike
  readonly storageDomain: StorageDomainLike
  readonly sessions: SessionsLike
  readonly workspaceRegistry: WorkspaceRegistryLike
}

/** Event methods of the Host context, typed loosely: the events belong to other packages. */
interface HostEvents {
  // biome-ignore lint/suspicious/noExplicitAny: listener payloads are narrowed at the call site
  on(name: string, listener: (...args: any[]) => unknown): () => void
}

/**
 * Host half: keeps each project's last agent preset and gives it to new or
 * reused blank Sessions of that project.
 * @param ctx - Host context.
 */
export async function apply(ctx: Context): Promise<void> {
  const services = ctx as unknown as HostServices
  const events = ctx as unknown as HostEvents
  const logger: LoggerPort = {
    info: (message) => ctx.logger.info(`mode-memory: ${message}`),
    warn: (message) => ctx.logger.warn(`mode-memory: ${message}`),
  }

  const domain = await services.storageDomain.open(MODE_MEMORY_DOMAIN)
  ctx.effect(() => () => domain.close(), "mode-memory: storage domain")

  const store = createModeMemoryStore(domain.table("projects"), Date.now)
  const memory = new ModeMemory({
    store,
    scope: createCreateScope(),
    roster: services.agentPresets,
    workspaces: {
      pathOf: (workspaceId) => services.workspaceRegistry.get(workspaceId)?.path,
    },
    sessions: {
      factsOf: (sessionId) => services.sessions.get(sessionId)?.header,
    },
    logger,
  })

  ctx.effect(
    () => installCreateHook(services.sessionController, memory),
    "mode-memory: session create hook",
  )

  events.on("agent-preset/selected", (sessionId: string, agentPreset: string) => {
    void memory.onPresetSelected(sessionId, agentPreset)
  })
}
