import type { Observable, RemoteResult } from "./types"

/**
 * Saves the Agent teamwork selection of one root Session. Resolves to null on
 * success, otherwise to a message that describes the failure.
 */
export type SaveTeamMode = (sessionId: string, enabled: boolean) => Promise<string | null>

/** The `remote.agentTeams` face of `@deepseek-ai/dsh-agent-team` this plugin calls. */
export interface AgentTeamsRemote {
  setEnabled(sessionId: string, enabled: boolean): Promise<RemoteResult<unknown>>
}

/**
 * Holds the save function while the Host's `remote.agentTeams` face is up, and
 * null otherwise, so the picker shows the Agent teamwork row only when the
 * selection can be saved.
 */
export interface TeamModeStore extends Observable<SaveTeamMode | null> {
  /** Use `remote` until the returned function runs. */
  connect(remote: AgentTeamsRemote): () => void
}

export function createTeamModeStore(): TeamModeStore {
  let save: SaveTeamMode | null = null
  const listeners = new Set<() => void>()
  const publish = (next: SaveTeamMode | null) => {
    save = next
    for (const listener of [...listeners]) listener()
  }
  return {
    getSnapshot: () => save,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    connect(remote) {
      const own: SaveTeamMode = async (sessionId, enabled) => {
        const result = await remote.setEnabled(sessionId, enabled)
        return result.ok ? null : result.error.message
      }
      publish(own)
      return () => {
        if (save === own) publish(null)
      }
    },
  }
}

/** The `agentTeam` projection fields the picker reads. */
export interface TeamModeProjection {
  readonly enabled: boolean
}

/** The `modelSelection` projection fields the picker reads. */
export interface ModelSelectionProjection {
  /** The model of the Session's last model step; null before the first one. */
  readonly lastUsed: unknown
}

/**
 * What a press on the switch does. Turning Agent teamwork off after the
 * Session has run asks first, like the shipped switch, because the tools and
 * the instructions leave every later request.
 */
export function teamToggleAction(
  next: boolean,
  modelSelection: ModelSelectionProjection | undefined,
): "save" | "confirm" {
  if (next) return "save"
  return modelSelection !== undefined && modelSelection.lastUsed !== null ? "confirm" : "save"
}
