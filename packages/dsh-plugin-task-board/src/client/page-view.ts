import type { BoardSnapshot, ProjectPath, ProjectSummary } from "../shared/model"
import type { BoardState } from "./state/board"
import type { ProjectsState } from "./state/project-list"
import type { Translate } from "./types"

export type PageView =
  | { readonly kind: "loading" }
  | { readonly kind: "noProjects" }
  | { readonly kind: "board"; readonly snapshot: BoardSnapshot }
  | { readonly kind: "blank" }

export type RetryTarget = "projects" | "board"

export interface NoticeView {
  readonly messages: readonly string[]
  readonly retry: RetryTarget | undefined
}

export type SelectionStep =
  | { readonly kind: "none" }
  | { readonly kind: "reload" }
  | { readonly kind: "select"; readonly project: ProjectPath | undefined }

export function pageView(list: ProjectsState, board: BoardState): PageView {
  if (list.status === "ready" && list.items.length === 0) return { kind: "noProjects" }
  if (board.snapshot !== undefined) return { kind: "board", snapshot: board.snapshot }
  if (list.status === "error" || board.status === "error") return { kind: "blank" }
  return { kind: "loading" }
}

export function noticeView(
  list: ProjectsState,
  board: BoardState,
  actionError: string | undefined,
  t: Translate,
): NoticeView | undefined {
  const projectsFailed = list.status === "error"
  const boardFailed = board.status === "error" && board.error !== undefined
  const messages = [
    projectsFailed ? t("projectsFailed", { message: list.message }) : undefined,
    boardFailed ? t("boardFailed", { message: board.error?.message }) : undefined,
    actionError,
  ].filter((message): message is string => message !== undefined)
  if (messages.length === 0) return undefined
  const retry = projectsFailed ? "projects" : boardFailed ? "board" : undefined
  return { messages, retry }
}

export function projectOf(
  projects: readonly ProjectSummary[],
  selected: ProjectPath | undefined,
): ProjectSummary | undefined {
  return projects.find((project) => project.path === selected)
}

export function reconcileSelection(
  list: ProjectsState,
  selected: ProjectPath | undefined,
): SelectionStep {
  if (list.status !== "ready") return { kind: "none" }
  const first = list.items[0]
  if (first === undefined) {
    return selected === undefined ? { kind: "none" } : { kind: "select", project: undefined }
  }
  if (selected === undefined) return { kind: "select", project: first.path }
  if (projectOf(list.items, selected) !== undefined) return { kind: "none" }
  if (list.requestedFor !== selected) return { kind: "reload" }
  return { kind: "select", project: first.path }
}
