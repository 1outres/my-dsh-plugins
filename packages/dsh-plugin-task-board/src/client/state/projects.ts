import type { ProjectPath } from "../../shared/model"
import { createSnapshotStore, type SnapshotStore } from "./store"

export const PROJECT_STORAGE_KEY = "task-board:project"

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface ProjectStore extends SnapshotStore<ProjectPath | undefined> {
  select(project: ProjectPath | undefined): void
}

export function browserStorage(): StorageLike | undefined {
  if (typeof window === "undefined") return undefined
  return window.localStorage
}

export function createProjectStore(storage: StorageLike | undefined): ProjectStore {
  const saved = storage?.getItem(PROJECT_STORAGE_KEY) ?? ""
  const store = createSnapshotStore<ProjectPath | undefined>(saved === "" ? undefined : saved)
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    select(project) {
      if (project === store.getSnapshot()) return
      if (project === undefined) storage?.removeItem(PROJECT_STORAGE_KEY)
      else storage?.setItem(PROJECT_STORAGE_KEY, project)
      store.set(project)
    },
  }
}
