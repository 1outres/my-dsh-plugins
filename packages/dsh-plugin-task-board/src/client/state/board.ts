import type { BoardSnapshot, ProjectPath } from "../../shared/model"
import type { TaskBoardFailure } from "../types"
import { createSnapshotStore, type SnapshotStore } from "./store"

export type BoardStatus = "idle" | "loading" | "ready" | "error"

export interface BoardState {
  readonly project: ProjectPath | undefined
  readonly status: BoardStatus
  readonly snapshot: BoardSnapshot | undefined
  readonly error: TaskBoardFailure | undefined
}

export interface BoardStore extends SnapshotStore<BoardState> {
  load(project: ProjectPath): void
  receive(project: ProjectPath, snapshot: BoardSnapshot): void
  fail(project: ProjectPath, error: TaskBoardFailure): void
  reset(): void
}

const IDLE: BoardState = {
  project: undefined,
  status: "idle",
  snapshot: undefined,
  error: undefined,
}

export function createBoardStore(): BoardStore {
  const store = createSnapshotStore<BoardState>(IDLE)
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    load(project) {
      const current = store.getSnapshot()
      if (current.project === project && current.status !== "error") return
      store.set({ project, status: "loading", snapshot: undefined, error: undefined })
    },
    receive(project, snapshot) {
      const current = store.getSnapshot()
      if (current.project !== project) return
      store.set({ project, status: "ready", snapshot, error: undefined })
    },
    fail(project, error) {
      const current = store.getSnapshot()
      if (current.project !== project) return
      store.set({ project, status: "error", snapshot: current.snapshot, error })
    },
    reset() {
      if (store.getSnapshot() === IDLE) return
      store.set(IDLE)
    },
  }
}
