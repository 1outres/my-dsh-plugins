import { useEffect, useMemo, useRef, useState } from "react"
import type { CardNumber, ProjectPath } from "../shared/model"
import { createBoardActions, createCardActions } from "./actions"
import { BoardHeader } from "./BoardHeader"
import { BoardSkeleton } from "./BoardSkeleton"
import { BoardView } from "./BoardView"
import { cardByNumber } from "./board"
import type { TaskBoardBridge } from "./bridge"
import { CardPanel } from "./CardPanel"
import { EmptyState } from "./EmptyState"
import { useSnapshot } from "./hooks"
import { Notice } from "./Notice"
import { noticeView, pageView, projectOf, reconcileSelection } from "./page-view"
import type { BoardStore } from "./state/board"
import type { ProjectListStore } from "./state/project-list"
import type { ProjectStore } from "./state/projects"
import type { SnapshotStore } from "./state/store"
import type { Translate } from "./types"
import { useProjectList } from "./use-project-list"

export interface BoardPageInjected {
  readonly bridge: TaskBoardBridge
  readonly projects: ProjectStore
  readonly projectList: ProjectListStore
  readonly board: BoardStore
  readonly locale: SnapshotStore<string>
  readonly clock: SnapshotStore<number>
  readonly t: Translate
}

export function BoardPage(face: BoardPageInjected) {
  const { bridge, projects, projectList, board, t } = face
  const selected = useSnapshot(projects)
  const list = useSnapshot(projectList)
  const state = useSnapshot(board)
  const locale = useSnapshot(face.locale)
  const now = useSnapshot(face.clock)
  const [watchKey, setWatchKey] = useState(0)
  const [actionError, setActionError] = useState<string | undefined>(undefined)
  const [openNumber, setOpenNumber] = useState<CardNumber | undefined>(undefined)
  const page = useRef<HTMLDivElement>(null)
  const reloadProjects = useProjectList(bridge, projectList, projects)

  useEffect(() => {
    const step = reconcileSelection(list, selected)
    if (step.kind === "reload") reloadProjects()
    if (step.kind === "select") projects.select(step.project)
  }, [list, projects, reloadProjects, selected])

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new project closes the open card
  useEffect(() => {
    setOpenNumber(undefined)
    setActionError(undefined)
  }, [selected])

  const snapshot = state.snapshot
  const project: ProjectPath | undefined = snapshot?.board.project
  const openCard =
    snapshot === undefined || openNumber === undefined
      ? undefined
      : cardByNumber(snapshot, openNumber)

  useEffect(() => {
    if (snapshot !== undefined && openNumber !== undefined && openCard === undefined) {
      setOpenNumber(undefined)
    }
  }, [snapshot, openNumber, openCard])

  const boardActions = useMemo(
    () =>
      project === undefined
        ? undefined
        : createBoardActions(bridge, project, (failure) => {
            setActionError(
              failure === undefined ? undefined : t("actionFailed", { message: failure.message }),
            )
          }),
    [bridge, project, t],
  )
  const cardActions = useMemo(
    () => (project === undefined ? undefined : createCardActions(bridge, project)),
    [bridge, project],
  )

  const closePanel = (): void => {
    const number = openNumber
    if (number !== undefined) {
      page.current?.querySelector<HTMLElement>(`[data-card-number="${String(number)}"]`)?.focus()
    }
    setOpenNumber(undefined)
  }

  const closeRef = useRef(closePanel)
  closeRef.current = closePanel

  useEffect(() => {
    if (openNumber === undefined) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      event.preventDefault()
      closeRef.current()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [openNumber])

  const retry = (): void => {
    if (list.status === "error") {
      reloadProjects()
      return
    }
    if (selected !== undefined) board.load(selected)
    setWatchKey((value) => value + 1)
  }

  const view = pageView(list, state)
  const notice = noticeView(list, state, actionError, t)

  return (
    <div className="tb-page" ref={page}>
      <div className="tb-main">
        <BoardHeader
          project={projectOf(list.items, selected)}
          projects={list.items}
          loading={list.status === "loading"}
          t={t}
          onSelect={(path) => projects.select(path)}
        />
        {notice === undefined ? null : <Notice notice={notice} t={t} onRetry={retry} />}
        {view.kind === "loading" ? <BoardSkeleton /> : null}
        {view.kind === "noProjects" ? <EmptyState title={t("noProjects")} /> : null}
        {view.kind === "board" && boardActions !== undefined ? (
          <BoardView
            snapshot={view.snapshot}
            actions={boardActions}
            openNumber={openCard?.number}
            t={t}
            onOpenCard={(number) => setOpenNumber(number)}
          />
        ) : null}
      </div>
      {openCard === undefined || snapshot === undefined || cardActions === undefined ? null : (
        <CardPanel
          key={openCard.number}
          card={openCard}
          columns={snapshot.board.columns}
          t={t}
          locale={locale}
          now={now}
          actions={cardActions}
          onClose={closePanel}
        />
      )}
    </div>
  )
}
