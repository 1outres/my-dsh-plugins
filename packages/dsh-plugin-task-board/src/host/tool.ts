import type { Agent } from "@deepseek-ai/dsh-agent"
import {
  defineTool,
  ToolContextUnavailableError,
  type ToolDefinition,
  type ToolRunContext,
  type ValueSchemaSpec,
} from "@deepseek-ai/dsh-tools"
import type {
  Card,
  ProjectPath,
  ProjectSummary,
  SessionId,
  TaskBoardOutcome,
} from "../shared/model"
import { columnTitleText, columnWithCard, findColumn } from "./columns"
import type { SessionDirectoryPort, TaskBoardService } from "./contract"
import { renderBoard, renderCard, renderCards } from "./render"

const TASK_BOARD_TOOL_DESCRIPTION = `Work with the task board of the current project. The board belongs to the project of your working directory, so you never pass a project.

Use "list" to see every column and its cards. Use "get" without a number to see the cards linked to this session, so you know which card you work on. Use "get" with a number to see one card in full.

Use "create" to add a card, "update" to change its title or description, "move" to put it in another column, and "comment" to report progress. Move a card to the "In progress" column when you start it, and to the "Done" column when you finish it. Add a comment when you make a decision or finish a step, so the user can follow the work.

Cards are numbered in each project, such as #12.`

const outputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    text: { type: "string", required: true },
  },
} satisfies ValueSchemaSpec

export interface TaskBoardToolDeps {
  readonly service: TaskBoardService
  readonly sessions: Pick<SessionDirectoryPort, "rootSessionOf">
  readonly directoryOfSession: (session: Agent["session"]) => string
}

function valueOfOutcome<T>(outcome: TaskBoardOutcome<T>): T {
  if (outcome.status === "error") throw new Error(outcome.error.message)
  return outcome.value
}

function agentOf(exec: ToolRunContext): Agent {
  if (exec.agent === undefined) {
    throw new ToolContextUnavailableError("task_board: this tool needs a calling agent session")
  }
  return exec.agent
}

async function projectOf(
  deps: TaskBoardToolDeps,
  session: Agent["session"],
): Promise<ProjectSummary> {
  const directory = deps.directoryOfSession(session)
  return valueOfOutcome(await deps.service.projectOfDirectory(directory))
}

async function linkedCards(
  deps: TaskBoardToolDeps,
  project: ProjectPath,
  sessionId: SessionId,
  rootSessionId: SessionId,
): Promise<readonly Card[]> {
  const own = valueOfOutcome(await deps.service.cardsOfSession(project, sessionId))
  if (own.length > 0 || rootSessionId === sessionId) return own
  return valueOfOutcome(await deps.service.cardsOfSession(project, rootSessionId))
}

async function getText(
  deps: TaskBoardToolDeps,
  project: ProjectPath,
  sessionId: SessionId,
  number: number | undefined,
): Promise<string> {
  if (number !== undefined) {
    const card = valueOfOutcome(await deps.service.card(project, number))
    const snapshot = valueOfOutcome(await deps.service.snapshot(project))
    const column = columnWithCard(snapshot.board, card.number)
    if (column === undefined) {
      throw new Error(`Card #${card.number} is not in any column of this board.`)
    }
    return renderCard(card, columnTitleText(column), sessionId)
  }
  const cards = await linkedCards(deps, project, sessionId, deps.sessions.rootSessionOf(sessionId))
  if (cards.length === 0) return "No card is linked to this session."
  const snapshot = valueOfOutcome(await deps.service.snapshot(project))
  return renderCards(snapshot, cards, sessionId)
}

async function createText(
  deps: TaskBoardToolDeps,
  project: ProjectPath,
  sessionId: SessionId,
  args: { title: string | undefined; description: string | undefined; column: string | undefined },
): Promise<string> {
  if (args.title === undefined) throw new Error("The create action needs a title.")
  const snapshot = valueOfOutcome(await deps.service.snapshot(project))
  const requested = args.column === undefined ? undefined : findColumn(snapshot.board, args.column)
  if (args.column !== undefined && requested === undefined) {
    throw new Error(`Column "${args.column}" does not exist in this board.`)
  }
  const target = requested ?? snapshot.board.columns[0]
  if (target === undefined) throw new Error("This board has no columns.")
  const card = valueOfOutcome(
    await deps.service.createCard(
      project,
      { title: args.title, description: args.description ?? "", columnId: target.id },
      { kind: "agent", sessionId },
    ),
  )
  return `Created card #${card.number} "${card.title}" in column "${columnTitleText(target)}".`
}

async function updateText(
  deps: TaskBoardToolDeps,
  project: ProjectPath,
  args: { number: number | undefined; title: string | undefined; description: string | undefined },
): Promise<string> {
  if (args.number === undefined) throw new Error("The update action needs a card number.")
  if (args.title === undefined && args.description === undefined) {
    throw new Error("The update action needs a title, a description, or both.")
  }
  const card = valueOfOutcome(
    await deps.service.updateCard(project, args.number, {
      ...(args.title === undefined ? {} : { title: args.title }),
      ...(args.description === undefined ? {} : { description: args.description }),
    }),
  )
  return `Updated card #${card.number} "${card.title}".`
}

async function moveText(
  deps: TaskBoardToolDeps,
  project: ProjectPath,
  args: { number: number | undefined; column: string | undefined },
): Promise<string> {
  if (args.number === undefined) throw new Error("The move action needs a card number.")
  if (args.column === undefined) throw new Error("The move action needs a column.")
  const snapshot = valueOfOutcome(await deps.service.snapshot(project))
  const column = findColumn(snapshot.board, args.column)
  if (column === undefined) throw new Error(`Column "${args.column}" does not exist in this board.`)
  const card = valueOfOutcome(
    await deps.service.moveCard(project, args.number, { columnId: column.id }),
  )
  return `Moved card #${card.number} to column "${columnTitleText(column)}".`
}

async function addCommentText(
  deps: TaskBoardToolDeps,
  project: ProjectPath,
  sessionId: SessionId,
  args: { number: number | undefined; body: string | undefined },
): Promise<string> {
  if (args.number === undefined) throw new Error("The comment action needs a card number.")
  if (args.body === undefined) throw new Error("The comment action needs a body.")
  valueOfOutcome(
    await deps.service.addComment(project, args.number, args.body, {
      kind: "agent",
      sessionId,
    }),
  )
  return `Added a comment to card #${args.number}.`
}

export function createTaskBoardTool(deps: TaskBoardToolDeps): ToolDefinition {
  return defineTool({
    name: "task_board",
    description: TASK_BOARD_TOOL_DESCRIPTION,
    parameters: {
      action: {
        type: "string",
        required: true,
        enum: ["list", "get", "create", "update", "move", "comment"],
        description: 'What to do: "list", "get", "create", "update", "move", or "comment".',
      },
      number: { type: "integer", description: "Card number, such as 12 for #12." },
      title: { type: "string", description: "Card title. Used by create and update." },
      description: {
        type: "string",
        description: "Card description in Markdown. Used by create and update.",
      },
      column: {
        type: "string",
        description:
          'Column id or title, such as "todo" or "In progress". The case does not matter. Used by create and move.',
      },
      body: { type: "string", description: "Comment text in Markdown. Used by comment." },
    },
    output: {
      schema: outputSchema,
      render: (_args, value) => [{ type: "text", text: value.text }],
    },
    async execute(args, exec) {
      const agent = agentOf(exec)
      const project = await projectOf(deps, agent.session)
      const sessionId = agent.id
      switch (args.action) {
        case "list":
          return {
            text: renderBoard(valueOfOutcome(await deps.service.snapshot(project.path)), sessionId),
          }
        case "get":
          return { text: await getText(deps, project.path, sessionId, args.number) }
        case "create":
          return {
            text: await createText(deps, project.path, sessionId, {
              title: args.title,
              description: args.description,
              column: args.column,
            }),
          }
        case "update":
          return {
            text: await updateText(deps, project.path, {
              number: args.number,
              title: args.title,
              description: args.description,
            }),
          }
        case "move":
          return {
            text: await moveText(deps, project.path, {
              number: args.number,
              column: args.column,
            }),
          }
        case "comment":
          return {
            text: await addCommentText(deps, project.path, sessionId, {
              number: args.number,
              body: args.body,
            }),
          }
      }
    },
    presentCall: (args) => ({
      card: "generic",
      title: `Task board: ${args.action}`,
      kind: "other",
    }),
    presentResult: (_args, result) => ({
      card: "generic",
      title: result.isError ? "Task board failed" : "Task board",
      content: result.content,
    }),
  })
}
