import type { Agent } from "@deepseek-ai/dsh-agent"
import type { CommandDefinition, CommandInvocation, CommandResult } from "@deepseek-ai/dsh-commands"
import { CommandDefinitionId } from "@deepseek-ai/dsh-commands/brand"
import { createUserMessage } from "@deepseek-ai/dsh-llm"
import type { CardNumber } from "../shared/model"
import { TASK_BOARD_COMMAND, TASK_BOARD_PACKAGE } from "../shared/remote"
import { columnTitleText, columnWithCard } from "./columns"
import type { TaskBoardService } from "./contract"
import { buildCardMessage } from "./message"

export const TASK_COMMAND_USAGE = "Usage: /task <card number>"

const CARD_INPUT = /^#?(\d+)$/u

export function parseCardNumber(input: string): CardNumber | undefined {
  const match = CARD_INPUT.exec(input.trim())
  if (match?.[1] === undefined) return undefined
  const number = Number(match[1])
  return Number.isSafeInteger(number) && number > 0 ? number : undefined
}

export interface TaskCommandDeps {
  readonly service: TaskBoardService
  readonly directoryOfSession: (session: Agent["session"]) => string
}

export interface CommandRegistry {
  register(definition: CommandDefinition): () => void
}

export function createTaskCommandHandler(
  deps: TaskCommandDeps,
): (invocation: CommandInvocation) => Promise<CommandResult> {
  return async (invocation) => {
    const number = parseCardNumber(invocation.rawInput)
    if (number === undefined) return { kind: "error", text: TASK_COMMAND_USAGE }
    const directory = deps.directoryOfSession(invocation.agent.session)
    const project = await deps.service.projectOfDirectory(directory)
    if (project.status === "error") return { kind: "error", text: project.error.message }
    const card = await deps.service.card(project.value.path, number)
    if (card.status === "error") return { kind: "error", text: card.error.message }
    const linked = await deps.service.linkSession(project.value.path, number, invocation.agent.id)
    if (linked.status === "error") return { kind: "error", text: linked.error.message }
    const snapshot = await deps.service.snapshot(project.value.path)
    if (snapshot.status === "error") return { kind: "error", text: snapshot.error.message }
    const column = columnWithCard(snapshot.value.board, number)
    if (column === undefined) {
      return { kind: "error", text: `Card #${number} is not in any column of this board.` }
    }
    invocation.agent.followup(
      createUserMessage({
        content: [{ type: "text", text: buildCardMessage(card.value, columnTitleText(column)) }],
        source: { kind: "user" },
      }),
    )
    return { kind: "success", text: `Sent #${number} "${card.value.title}" to the agent.` }
  }
}

export function registerTaskCommand(commands: CommandRegistry, deps: TaskCommandDeps): () => void {
  return commands.register({
    definitionId: CommandDefinitionId(TASK_BOARD_PACKAGE),
    name: TASK_BOARD_COMMAND,
    description: "Send a task board card to the agent of this session",
    input: { hint: "<card number>" },
    handler: createTaskCommandHandler(deps),
  })
}
