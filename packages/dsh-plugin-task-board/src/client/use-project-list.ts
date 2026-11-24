import { useCallback, useEffect } from "react"
import type { TaskBoardBridge } from "./bridge"
import type { ProjectListStore } from "./state/project-list"
import type { ProjectStore } from "./state/projects"

export function useProjectList(
  bridge: TaskBoardBridge,
  list: ProjectListStore,
  projects: ProjectStore,
): () => void {
  const load = useCallback(() => {
    const request = list.request(projects.getSnapshot())
    void bridge.projects().then((result) => list.resolve(request, result))
  }, [bridge, list, projects])
  useEffect(() => {
    load()
  }, [load])
  return load
}
