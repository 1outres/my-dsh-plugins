import { useEffect, useState } from "react"
import type {
  BoardSnapshot,
  Card,
  CardNumber,
  ColumnId,
  CreateCardInput,
  ProjectPath,
  ProjectSummary,
  UpdateCardInput,
} from "../shared/model"
import { AddColumnForm } from "./AddColumnForm"
import { BoardColumn } from "./BoardColumn"
import { cardByNumber, columnCards, dropIndex } from "./board"
import type { TaskBoardBridge } from "./bridge"
import { CardDialog } from "./CardDialog"
import { useSnapshot } from "./hooks"
import type { BoardStore } from "./state/board"
import type { ProjectStore } from "./state/projects"
import type { TaskBoardResult, Translate } from "./types"

export interface BoardPageInjected {
  readonly bridge: TaskBoardBridge
  readonly projects: ProjectStore
  readonly board: BoardStore
  readonly t: Translate
}

interface ProjectsState {
  readonly status: "loading" | "ready" | "error"
  readonly items: readonly ProjectSummary[]
  readonly message?: string
}

export function BoardPage({ bridge, projects, board, t }: BoardPageInjected) {
  const selected = useSnapshot(projects)
  const state = useSnapshot(board)
  const [list, setList] = useState<ProjectsState>({ status: "loading", items: [] })
  const [listKey, setListKey] = useState(0)
  const [watchKey, setWatchKey] = useState(0)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [openNumber, setOpenNumber] = useState<CardNumber | undefined>(undefined)

  // biome-ignore lint/correctness/useExhaustiveDependencies: listKey restarts the project read
  useEffect(() => {
    let cancelled = false
    setList({ status: "loading", items: [] })
    void bridge.projects().then((result) => {
      if (cancelled) return
      if (result.status === "error") {
        setList({ status: "error", items: [], message: result.error.message })
        return
      }
      setList({ status: "ready", items: result.value })
    })
    return () => {
      cancelled = true
    }
  }, [bridge, listKey])

  useEffect(() => {
    if (list.status !== "ready" || selected !== undefined) return
    const first = list.items[0]
    if (first !== undefined) projects.select(first.path)
  }, [list, projects, selected])

  // biome-ignore lint/correctness/useExhaustiveDependencies: watchKey restarts the watch
  useEffect(() => {
    if (selected === undefined) {
      board.reset()
      return
    }
    board.load(selected)
    return bridge.watch(
      selected,
      (snapshot) => board.receive(selected, snapshot),
      (error) => board.fail(selected, error),
    )
  }, [board, bridge, selected, watchKey])

  const snapshot = state.snapshot
  const pickerValue =
    selected !== undefined && list.items.some((project) => project.path === selected)
      ? selected
      : ""
  const openCard =
    snapshot === undefined || openNumber === undefined
      ? undefined
      : cardByNumber(snapshot, openNumber)

  // biome-ignore lint/correctness/useExhaustiveDependencies: selected closes the open card
  useEffect(() => {
    setOpenNumber(undefined)
    setNotice(undefined)
  }, [selected])

  const runAction = async (action: () => Promise<TaskBoardResult<unknown>>): Promise<void> => {
    const result = await action()
    setNotice(
      result.status === "error" ? t("actionFailed", { message: result.error.message }) : undefined,
    )
  }

  const retryBoard = (): void => {
    if (selected !== undefined) board.load(selected)
    setWatchKey((value) => value + 1)
  }

  const messages = [
    ...new Set(
      [
        notice,
        list.status === "error" && list.message !== undefined
          ? t("projectsFailed", { message: list.message })
          : undefined,
        state.error === undefined ? undefined : t("boardFailed", { message: state.error.message }),
      ].filter((message): message is string => message !== undefined),
    ),
  ]

  const renderBoard = (project: ProjectPath, current: BoardSnapshot) => {
    const columns = current.board.columns
    return (
      <div className="tb-columns">
        {columns.map((column, index) => (
          <BoardColumn
            key={column.id}
            column={column}
            cards={columnCards(current, column)}
            index={index}
            columnCount={columns.length}
            t={t}
            onOpenCard={(card: Card) => setOpenNumber(card.number)}
            onCreateCard={(columnId: ColumnId, title: string, description: string) => {
              const input: CreateCardInput = { title, description, columnId }
              return runAction(() => bridge.createCard(project, input))
            }}
            onRenameColumn={(columnId: ColumnId, title: string) =>
              runAction(() => bridge.renameColumn(project, columnId, title))
            }
            onMoveColumn={(columnId: ColumnId, index: number) =>
              runAction(() => bridge.moveColumn(project, columnId, index))
            }
            onDeleteColumn={(columnId: ColumnId) =>
              runAction(() => bridge.deleteColumn(project, columnId))
            }
            onDropCard={(
              columnId: ColumnId,
              moving: CardNumber,
              before: CardNumber | undefined,
            ) => {
              const column = columns.find((candidate) => candidate.id === columnId)
              if (column === undefined) return
              void runAction(() =>
                bridge.moveCard(project, moving, {
                  columnId,
                  index: dropIndex(column.cardNumbers, moving, before),
                }),
              )
            }}
          />
        ))}
        <AddColumnForm t={t} onAdd={(title) => runAction(() => bridge.addColumn(project, title))} />
        {openCard === undefined ? null : (
          <CardDialog
            card={openCard}
            t={t}
            actions={{
              save: (number: CardNumber, input: UpdateCardInput) =>
                bridge.updateCard(project, number, input),
              addComment: (number: CardNumber, body: string) =>
                bridge.addComment(project, number, body),
              deleteComment: (number: CardNumber, commentId) =>
                bridge.deleteComment(project, number, commentId),
              unlinkSession: (number: CardNumber, sessionId) =>
                bridge.unlinkSession(project, number, sessionId),
              deleteCard: (number: CardNumber) => bridge.deleteCard(project, number),
            }}
            onClose={() => setOpenNumber(undefined)}
            onDeleted={() => setOpenNumber(undefined)}
          />
        )}
      </div>
    )
  }

  const body = (() => {
    if (list.status === "ready" && list.items.length === 0) {
      return <div className="tb-empty">{t("noProjects")}</div>
    }
    if (snapshot !== undefined) {
      return renderBoard(snapshot.board.project, snapshot)
    }
    if (selected === undefined) return <div className="tb-empty">{t("chooseProject")}</div>
    if (state.status === "error") {
      return <div className="tb-empty">{t("boardFailed", { message: state.error?.message })}</div>
    }
    return <div className="tb-empty">{t("loading")}</div>
  })()

  return (
    <div className="tb-page">
      <header className="tb-header">
        <div className="tb-heading">
          <h1 className="tb-title">{t("title")}</h1>
          {selected === undefined ? null : <p className="tb-project-path">{selected}</p>}
        </div>
        <label className="tb-project-picker">
          <span>{t("project")}</span>
          <select
            value={pickerValue}
            aria-label={t("project")}
            disabled={list.status !== "ready" || list.items.length === 0}
            onChange={(event) => {
              projects.select(event.target.value === "" ? undefined : event.target.value)
            }}
          >
            <option value="">{t("chooseProject")}</option>
            {list.items.map((project) => (
              <option key={project.path} value={project.path}>
                {project.title}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="tb-refresh"
          onClick={() => {
            setListKey((value) => value + 1)
          }}
        >
          {t("reload")}
        </button>
      </header>
      {messages.length === 0 ? null : (
        <div className="tb-notices" role="alert">
          {messages.map((message) => (
            <p key={message}>{message}</p>
          ))}
          {state.status === "error" ? (
            <button type="button" onClick={retryBoard}>
              {t("retry")}
            </button>
          ) : null}
        </div>
      )}
      {list.status === "loading" && snapshot === undefined ? (
        <p className="tb-muted">{t("loadingProjects")}</p>
      ) : null}
      {body}
    </div>
  )
}
