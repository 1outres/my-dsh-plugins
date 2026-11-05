import { homedir } from "node:os"
import type { Context } from "@deepseek-ai/cordis"
import z from "@deepseek-ai/schemastery"
import { nodeFs } from "./host/fs"
import { Scratchpad } from "./host/scratchpad"
import type { HeaderLike, LoggerLike, RegistryLike, SessionStartSource } from "./host/types"
import { DEFAULT_ROOT, resolveRoot } from "./shared/paths"

export const name = "scratchpad"

/** `sessions` is the Host's in-memory Session store; the others own Workspaces and logs. */
export const inject = ["workspaceRegistry", "sessionPersistence", "sessions"]

/** Settings. Changing either restarts the Host half. */
export const Config = z.object({
  root: z
    .string()
    .default(DEFAULT_ROOT)
    .description("Directory that holds the scratches. A leading ~ is your home directory."),
  registerRoot: z
    .boolean()
    .default(true)
    .description(
      "Register the root as a workspace when a scratch is created, so Workspace Tree grouping nests every scratch under it.",
    ),
})

export interface ScratchpadConfig {
  root: string
  registerRoot: boolean
}

interface SessionLike {
  readonly header: HeaderLike
}

interface HostServices {
  workspaceRegistry: RegistryLike
  sessionPersistence: { list(): Promise<readonly SessionLike[]> }
  sessions: { get(id: string): SessionLike | undefined; list(): readonly SessionLike[] }
}

/** Event methods of the Host context, typed loosely: the events belong to other packages. */
interface HostEvents {
  // biome-ignore lint/suspicious/noExplicitAny: listener payloads are narrowed at the call site
  on(name: string, listener: (...args: any[]) => unknown): () => void
  waterfall<T>(name: string, payload: unknown, last: () => Promise<T>): Promise<T>
}

interface AgentsLike {
  get(id: string): object | undefined
}

interface TerminalsLike {
  hasOwnerActivity(owner: object): boolean
}

/** `domain/changed` payload (`@deepseek-ai/dsh-storage-domain`). */
export interface DomainChange {
  domain: string
  table: string
  key: string
  operation: "put" | "deleted"
  value?: unknown
}

/**
 * The archive set carried by a Workspace registry state write.
 * @returns the archived Session ids, or undefined when the change is something else.
 */
export function archivedIdsOf(change: DomainChange): string[] | undefined {
  if (change.domain !== "workspace" || change.table !== "" || change.operation !== "put") {
    return undefined
  }
  const value = change.value as { workspaceIds?: unknown; archivedSessionIds?: unknown } | null
  if (typeof value !== "object" || value === null || !Array.isArray(value.workspaceIds)) {
    return undefined
  }
  // Older states omit the field; the registry reads that as an empty set.
  const ids = value.archivedSessionIds ?? []
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) return undefined
  return ids
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", stop)
      resolve()
    }, ms)
    const stop = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener("abort", stop, { once: true })
  })
}

/**
 * Host half: registers each new scratch as its own Workspace, moves a scratch
 * to `<root>/.archived` when all of its Sessions are archived, and moves it
 * back when one is unarchived. The browser half creates scratches.
 */
export function apply(ctx: Context, config: ScratchpadConfig): void {
  const services = ctx as unknown as HostServices
  const events = ctx as unknown as HostEvents
  const logger: LoggerLike = {
    info: (message) => ctx.logger.info(message),
    warn: (message) => ctx.logger.warn(message),
  }
  const root = resolveRoot(config.root, homedir())
  if (root === undefined) {
    logger.warn(`scratchpad: root '${config.root}' is not an absolute path; nothing is managed`)
    return
  }

  const pad = new Scratchpad({
    root,
    registerRoot: config.registerRoot,
    registry: services.workspaceRegistry,
    headers: async () => {
      const byId = new Map<string, HeaderLike>()
      for (const session of await services.sessionPersistence.list()) {
        byId.set(session.header.id, session.header)
      }
      for (const session of services.sessions.list()) byId.set(session.header.id, session.header)
      return [...byId.values()]
    },
    liveHeader: (sessionId) => services.sessions.get(sessionId)?.header,
    busy: async (sessionId) => {
      const activity = await events.waterfall<readonly unknown[]>(
        "workspace/session-activity",
        { sessionId },
        () => Promise.resolve([]),
      )
      if (activity.length > 0) return true
      const agent = (ctx.get("agents") as AgentsLike | undefined)?.get(sessionId)
      const terminals = ctx.get("terminals") as TerminalsLike | undefined
      return agent !== undefined && terminals?.hasOwnerActivity(agent) === true
    },
    fs: nodeFs,
    logger,
    sleep,
    now: Date.now,
  })

  // Serial and awaited before the Agent goes live; this listener never throws or waits.
  events.on("agent/created", (payload: { agent: { id: string }; source: SessionStartSource }) => {
    try {
      pad.onSessionStarted(payload.agent.id, payload.source)
    } catch (error) {
      logger.warn(`scratchpad: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  // Emitted synchronously after each durable registry write, before any Client hears of it.
  events.on("domain/changed", (change: DomainChange) => {
    const archived = archivedIdsOf(change)
    if (archived === undefined) return
    try {
      pad.onArchiveSetChanged(archived)
    } catch (error) {
      logger.warn(`scratchpad: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  ctx.effect(() => {
    pad.start().catch((error: unknown) => {
      logger.warn(
        `scratchpad: startup check failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
    return () => pad.dispose()
  }, "scratchpad: archive bookkeeping")
}
