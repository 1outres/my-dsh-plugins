import type { Author } from "../shared/model"
import type { TaskBoardResult, Translate } from "./types"

export function firstLine(text: string): string {
  return (text.split("\n")[0] ?? "").trim()
}

export function shortSessionId(sessionId: string): string {
  return sessionId.slice(0, 8)
}

export function authorText(author: Author, t: Translate): string {
  if (author.kind === "user") return t("authorYou")
  return t("authorAgent", { id: shortSessionId(author.sessionId) })
}

export function failureText(
  result: TaskBoardResult<unknown>,
  t: Translate,
  key: string,
): string | undefined {
  if (result.status === "ok") return undefined
  return t(key, { message: result.error.message })
}
