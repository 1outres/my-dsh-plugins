import type {
  BoardTable,
  CardTable,
  FileSystemPort,
  PathKind,
  ProjectResolver,
  WorkspaceDirectory,
  WorkspaceEntry,
} from "../src/host/contract"
import type {
  Board,
  Card,
  Column,
  ColumnPreset,
  ColumnTitle,
  ProjectSummary,
  TaskBoardErrorCode,
  TaskBoardOutcome,
} from "../src/shared/model"

export interface MemoryTables {
  readonly boards: BoardTable
  readonly cards: CardTable
}

export function createMemoryTables(): MemoryTables {
  const boards = new Map<string, Board>()
  const cards = new Map<string, Card>()
  return {
    boards: {
      get: (project) => boards.get(project),
      put: async (project, board) => {
        boards.set(project, board)
      },
    },
    cards: {
      get: (key) => cards.get(key),
      entries: () => cards.entries(),
      put: async (key, card) => {
        cards.set(key, card)
      },
      delete: async (key) => cards.delete(key),
    },
  }
}

export function projectSummary(
  path: string,
  overrides: Partial<ProjectSummary> = {},
): ProjectSummary {
  const parts = path.split("/").filter((part) => part.length > 0)
  return {
    path,
    title: parts.length === 0 ? path : String(parts[parts.length - 1]),
    workspaceId: `workspace:${path}`,
    ...overrides,
  }
}

export function createFakeWorkspaces(
  entries: readonly WorkspaceEntry[],
): WorkspaceDirectory & { readonly entries: readonly WorkspaceEntry[] } {
  return { entries, list: () => entries }
}

export interface FakeFile {
  readonly kind: PathKind
  readonly text?: string
}

export function createFakeFileSystem(
  files: Readonly<Record<string, FakeFile>>,
  realpaths: Readonly<Record<string, string>> = {},
): FileSystemPort {
  const kindOf = (path: string): PathKind => files[path]?.kind ?? "missing"
  return {
    realpath: async (path) => {
      const target = realpaths[path] ?? path
      if (kindOf(target) === "missing") {
        throw Object.assign(new Error(`ENOENT: no such file or directory, realpath ${path}`), {
          code: "ENOENT",
        })
      }
      return target
    },
    kind: async (path) => kindOf(path),
    readText: async (path) => {
      const text = files[path]?.text
      if (text === undefined) {
        throw Object.assign(new Error(`ENOENT: no such file or directory, open ${path}`), {
          code: "ENOENT",
        })
      }
      return text
    },
  }
}

export function ok<T>(value: T): TaskBoardOutcome<T> {
  return { status: "ok", value }
}

export function fail<T = never>(code: TaskBoardErrorCode, message: string): TaskBoardOutcome<T> {
  return { status: "error", error: { code, message } }
}

export function createFakeResolver(
  projects: readonly ProjectSummary[],
  directories: Readonly<Record<string, ProjectSummary>> = {},
): ProjectResolver {
  const byPath = new Map(projects.map((project) => [project.path, project]))
  return {
    projects: () => projects,
    project: (path) => byPath.get(path),
    resolveDirectory: async (directory) => {
      const project = directories[directory]
      return project === undefined
        ? fail("project_not_found", `No project is registered for ${directory}.`)
        : ok(project)
    },
  }
}

export function presetTitle(preset: ColumnPreset): ColumnTitle {
  return { kind: "preset", preset }
}

export function column(
  id: string,
  title: ColumnTitle,
  cardNumbers: readonly number[] = [],
): Column {
  return { id, title, cardNumbers }
}

export function buildBoard(overrides: Partial<Board> = {}): Board {
  return {
    project: "/repo",
    columns: [
      column("todo", presetTitle("todo")),
      column("in_progress", presetTitle("in_progress")),
      column("done", presetTitle("done")),
    ],
    nextCardNumber: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  }
}

export function buildCard(overrides: Partial<Card> = {}): Card {
  return {
    project: "/repo",
    number: 1,
    title: "Fix the login form",
    description: "",
    comments: [],
    sessionIds: [],
    createdBy: { kind: "user" },
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  }
}
