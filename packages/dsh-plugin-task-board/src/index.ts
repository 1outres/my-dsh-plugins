import { randomUUID } from "node:crypto"
import type { Context } from "@deepseek-ai/cordis"
import type { Agent } from "@deepseek-ai/dsh-agent"
import type { CommandDefinition } from "@deepseek-ai/dsh-commands"
import type { Session } from "@deepseek-ai/dsh-session"
import type { ToolDefinition } from "@deepseek-ai/dsh-tools"
import { createTaskBoardApi } from "./host/api"
import { registerTaskCommand } from "./host/command"
import type {
  BoardTable,
  CardTable,
  ProjectResolver,
  SessionDirectoryPort,
  TaskBoardService,
  WorkspaceEntry,
} from "./host/contract"
import { TASK_BOARD_DOMAIN } from "./host/domain"
import { createNodeFileSystem } from "./host/node-fs"
import { createProjectResolver } from "./host/project"
import { TaskBoardRemoteService } from "./host/remote"
import { createTaskBoardService } from "./host/service"
import { createSessionDirectory } from "./host/session-directory"
import { createBoardStore } from "./host/store"
import { createTaskBoardTool } from "./host/tool"

export const name = "task-board"

export const inject = [
  "tools",
  "commands",
  "storageDomain",
  "workspaceRegistry",
  "sessionQuery",
  "workingDirectory",
  "agents",
  "subagents",
]

interface OpenDomain {
  table(name: "boards"): BoardTable
  table(name: "cards"): CardTable
  close(): Promise<void>
}

interface StorageDomainLike {
  open(spec: typeof TASK_BOARD_DOMAIN): Promise<OpenDomain>
}

interface WorkspaceRegistryLike {
  list(): readonly WorkspaceEntry[]
}

interface SessionQueryLike {
  inspectSession<T>(sessionId: string, read: (session: Session) => T): Promise<T>
}

interface WorkingDirectoryLike {
  get(session: Session): string
}

interface AgentsLike {
  get(sessionId: string): Agent | undefined
}

interface SubagentsLike {
  rootOf(agent: Agent): Agent
}

interface ToolsLike {
  register(definition: ToolDefinition): () => void
}

interface CommandsLike {
  register(definition: CommandDefinition): () => void
}

interface HostServices {
  readonly tools: ToolsLike
  readonly commands: CommandsLike
  readonly storageDomain: StorageDomainLike
  readonly workspaceRegistry: WorkspaceRegistryLike
  readonly sessionQuery: SessionQueryLike
  readonly workingDirectory: WorkingDirectoryLike
  readonly agents: AgentsLike
  readonly subagents: SubagentsLike
}

export async function apply(ctx: Context): Promise<void> {
  const services = ctx as unknown as HostServices
  const domain = await services.storageDomain.open(TASK_BOARD_DOMAIN)
  ctx.effect(() => () => domain.close(), "task-board: storage domain")

  const store = createBoardStore(domain.table("boards"), domain.table("cards"))
  const resolver: ProjectResolver = createProjectResolver(
    { list: () => services.workspaceRegistry.list() },
    createNodeFileSystem(),
  )
  const service: TaskBoardService = createTaskBoardService({
    store,
    resolver,
    clock: { now: Date.now },
    ids: { next: () => randomUUID() },
  })
  const sessions: SessionDirectoryPort = createSessionDirectory({
    sessionQuery: services.sessionQuery,
    workingDirectory: services.workingDirectory,
    agents: services.agents,
    subagents: services.subagents,
  })
  const directoryOfSession = (session: Session): string => services.workingDirectory.get(session)

  services.tools.register(createTaskBoardTool({ service, sessions, directoryOfSession }))
  registerTaskCommand(
    { register: (definition) => services.commands.register(definition) },
    { service, directoryOfSession },
  )
  new TaskBoardRemoteService(ctx, createTaskBoardApi({ service, sessions }))
}
