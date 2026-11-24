import type { ProjectPath, ProjectSummary, TaskBoardOutcome } from "../shared/model"
import type {
  FileSystemPort,
  ProjectResolver,
  WorkspaceDirectory,
  WorkspaceEntry,
} from "./contract"
import { checkoutDirectory } from "./git"

const TRAILING_SEPARATORS = /[\\/]+$/
const DRIVE_ROOT = /^[A-Za-z]:$/

export function normalizeProjectPath(path: string): string | undefined {
  if (path === "") return undefined
  const stripped = path.replace(TRAILING_SEPARATORS, "")
  if (stripped === "" || DRIVE_ROOT.test(stripped)) return path
  return stripped
}

function summaryOf(entry: WorkspaceEntry, path: ProjectPath): ProjectSummary {
  return { path, title: entry.title, workspaceId: entry.id }
}

function isInside(parent: ProjectPath, child: ProjectPath): boolean {
  if (parent === child) return true
  const separator = parent.includes("\\") && !parent.includes("/") ? "\\" : "/"
  const prefix = parent.endsWith("/") || parent.endsWith("\\") ? parent : parent + separator
  return child.startsWith(prefix)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

class WorkspaceProjectResolver implements ProjectResolver {
  readonly #workspaces: WorkspaceDirectory
  readonly #fs: FileSystemPort

  constructor(workspaces: WorkspaceDirectory, fs: FileSystemPort) {
    this.#workspaces = workspaces
    this.#fs = fs
  }

  projects(): readonly ProjectSummary[] {
    return this.#entries().map((entry) => summaryOf(entry, this.#pathOf(entry)))
  }

  project(path: ProjectPath): ProjectSummary | undefined {
    const normalized = normalizeProjectPath(path)
    if (normalized === undefined) return undefined
    const entry = this.#entries().find((candidate) => this.#pathOf(candidate) === normalized)
    return entry === undefined ? undefined : summaryOf(entry, this.#pathOf(entry))
  }

  async resolveDirectory(directory: string): Promise<TaskBoardOutcome<ProjectSummary>> {
    let real: string
    try {
      real = await this.#fs.realpath(directory)
    } catch (error) {
      return {
        status: "error",
        error: {
          code: "project_not_found",
          message: `Cannot read the directory ${directory}: ${messageOf(error)}`,
        },
      }
    }
    const mapped = await checkoutDirectory(real, this.#fs)
    const candidates = this.#entries()
      .map((entry) => summaryOf(entry, this.#pathOf(entry)))
      .filter((candidate) => isInside(candidate.path, mapped))
      .sort((left, right) => right.path.length - left.path.length)
    const match = candidates[0]
    if (match === undefined) {
      return {
        status: "error",
        error: { code: "project_not_found", message: `No project is registered for ${directory}.` },
      }
    }
    return { status: "ok", value: match }
  }

  #entries(): readonly WorkspaceEntry[] {
    return [...this.#workspaces.list()]
  }

  #pathOf(entry: WorkspaceEntry): ProjectPath {
    const path = normalizeProjectPath(entry.path)
    if (path === undefined) {
      throw new Error(`The workspace ${entry.id} has no path.`)
    }
    return path
  }
}

export function createProjectResolver(
  workspaces: WorkspaceDirectory,
  fs: FileSystemPort,
): ProjectResolver {
  return new WorkspaceProjectResolver(workspaces, fs)
}
