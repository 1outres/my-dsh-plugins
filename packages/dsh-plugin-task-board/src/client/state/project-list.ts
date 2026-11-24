import type { ProjectPath, ProjectSummary } from "../../shared/model"
import type { TaskBoardResult } from "../types"
import { createSnapshotStore, type SnapshotStore } from "./store"

export type ProjectsStatus = "loading" | "ready" | "error"

export interface ProjectsState {
  readonly status: ProjectsStatus
  readonly items: readonly ProjectSummary[]
  readonly message?: string
  readonly requestedFor: ProjectPath | undefined
}

export interface ProjectListRequest {
  readonly sequence: number
}

export interface ProjectListStore extends SnapshotStore<ProjectsState> {
  request(selected: ProjectPath | undefined): ProjectListRequest
  resolve(request: ProjectListRequest, result: TaskBoardResult<readonly ProjectSummary[]>): void
}

export function createProjectListStore(): ProjectListStore {
  const store = createSnapshotStore<ProjectsState>({
    status: "loading",
    items: [],
    requestedFor: undefined,
  })
  let sequence = 0
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    request(selected) {
      sequence += 1
      store.set({ status: "loading", items: store.getSnapshot().items, requestedFor: selected })
      return { sequence }
    },
    resolve(request, result) {
      if (request.sequence !== sequence) return
      const { items, requestedFor } = store.getSnapshot()
      if (result.status === "ok") {
        store.set({ status: "ready", items: result.value, requestedFor })
        return
      }
      store.set({ status: "error", items, message: result.error.message, requestedFor })
    },
  }
}
