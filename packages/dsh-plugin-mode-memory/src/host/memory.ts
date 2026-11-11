import type {
  CreateInterceptor,
  CreateScope,
  CreateSession,
  LoggerPort,
  ModeMemoryStore,
  PresetRosterEntry,
  PresetRosterPort,
  SessionCreateRequest,
  SessionCreateValue,
  SessionsPort,
  WorkspacesPort,
} from "../contract"
import { normalizeProject } from "./project"

/** The services the memory needs. */
export interface ModeMemoryOptions {
  readonly store: ModeMemoryStore
  readonly roster: PresetRosterPort
  readonly workspaces: WorkspacesPort
  readonly sessions: SessionsPort
  readonly logger: LoggerPort
  readonly scope: CreateScope
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Remembers each project's last agent preset and applies it to blank Sessions. */
export class ModeMemory implements CreateInterceptor {
  readonly #store: ModeMemoryStore
  readonly #roster: PresetRosterPort
  readonly #workspaces: WorkspacesPort
  readonly #sessions: SessionsPort
  readonly #logger: LoggerPort
  readonly #scope: CreateScope

  constructor(options: ModeMemoryOptions) {
    this.#store = options.store
    this.#roster = options.roster
    this.#workspaces = options.workspaces
    this.#sessions = options.sessions
    this.#logger = options.logger
    this.#scope = options.scope
  }

  async intercept(
    request: SessionCreateRequest,
    create: CreateSession,
  ): Promise<SessionCreateValue> {
    const project = this.#projectOf(request)
    if (project === undefined) return this.#scope.run(() => create(request))

    if (request.agentPreset !== undefined) {
      const result = await this.#scope.run(() => create(request))
      try {
        await this.#store.remember(project, result.agentPreset ?? request.agentPreset)
      } catch (error) {
        this.#logger.warn(`could not remember the preset for ${project}: ${messageOf(error)}`)
      }
      return result
    }

    const remembered = this.#store.get(project)
    if (remembered === undefined) return this.#scope.run(() => create(request))

    let preset: PresetRosterEntry | undefined
    try {
      preset = (await this.#roster.list()).find((entry) => entry.id === remembered.agentPreset)
    } catch (error) {
      this.#logger.warn(`could not read the preset roster: ${messageOf(error)}`)
      return this.#scope.run(() => create(request))
    }

    if (preset === undefined || preset.broken !== undefined) {
      await this.#forget(project)
      this.#logger.info(
        preset === undefined
          ? `forgot preset '${remembered.agentPreset}' for ${project}: it is no longer available`
          : `forgot preset '${remembered.agentPreset}' for ${project}: it is broken`,
      )
      return this.#scope.run(() => create(request))
    }

    return this.#scope.run(() => create({ ...request, agentPreset: remembered.agentPreset }))
  }

  async onPresetSelected(sessionId: string, agentPreset: string): Promise<void> {
    if (this.#scope.active()) return
    const project = this.#projectOfSession(sessionId)
    if (project === undefined) return
    try {
      await this.#store.remember(project, agentPreset)
    } catch (error) {
      this.#logger.warn(`could not remember the preset for ${project}: ${messageOf(error)}`)
    }
  }

  #projectOf(request: SessionCreateRequest): string | undefined {
    const path =
      request.workspaceId !== undefined ? this.#workspaces.pathOf(request.workspaceId) : request.cwd
    return path === undefined ? undefined : normalizeProject(path)
  }

  #projectOfSession(sessionId: string): string | undefined {
    const facts = this.#sessions.factsOf(sessionId)
    if (facts === undefined || facts.origin === "subagent" || facts.cwd === undefined) {
      return undefined
    }
    return normalizeProject(facts.cwd)
  }

  async #forget(project: string): Promise<void> {
    try {
      await this.#store.forget(project)
    } catch (error) {
      this.#logger.warn(`could not forget the preset for ${project}: ${messageOf(error)}`)
    }
  }
}
