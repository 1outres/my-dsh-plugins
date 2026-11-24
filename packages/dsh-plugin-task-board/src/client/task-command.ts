import { TASK_BOARD_COMMAND } from "../shared/remote"
import { cardNumberFromOption } from "./task-options"
import type { CommandsRemote, Translate } from "./types"

export interface RunTaskCommandOptions {
  readonly commands: CommandsRemote
  readonly sessionId: string
  readonly optionId: string
  readonly t: Translate
}

export async function runTaskCommand(options: RunTaskCommandOptions): Promise<void> {
  const number = cardNumberFromOption(options.optionId)
  const line = `/${TASK_BOARD_COMMAND} ${String(number)}`
  const result = await options.commands.execute(options.sessionId, line, [])
  if (!result.ok) {
    throw new Error(options.t("task.runFailed", { message: result.error.message }))
  }
  if (result.value === undefined) {
    throw new Error(options.t("task.unknownCommand"))
  }
  if (result.value.result.kind === "error") {
    throw new Error(options.t("task.runFailed", { message: result.value.result.text }))
  }
}
