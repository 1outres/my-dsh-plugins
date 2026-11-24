import type { Agent } from "@deepseek-ai/dsh-agent"
import type { Session } from "@deepseek-ai/dsh-session"
import type { SessionId } from "../shared/model"
import type { SessionDirectoryPort } from "./contract"

export interface SessionDirectoryPorts {
  readonly sessionQuery: {
    inspectSession<T>(sessionId: SessionId, read: (session: Session) => T): Promise<T>
  }
  readonly workingDirectory: { get(session: Session): string }
  readonly agents: { get(sessionId: SessionId): Agent | undefined }
  readonly subagents: { rootOf(agent: Agent): Agent }
}

export function createSessionDirectory(ports: SessionDirectoryPorts): SessionDirectoryPort {
  return {
    directoryOf: (sessionId) =>
      ports.sessionQuery.inspectSession(sessionId, (session) =>
        ports.workingDirectory.get(session),
      ),
    rootSessionOf: (sessionId) => {
      const agent = ports.agents.get(sessionId)
      if (agent === undefined) return sessionId
      return ports.subagents.rootOf(agent).id
    },
  }
}
