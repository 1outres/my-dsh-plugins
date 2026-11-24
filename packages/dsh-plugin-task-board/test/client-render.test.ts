import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { BoardPage, type BoardPageInjected } from "../src/client/BoardPage"
import { CardPanel } from "../src/client/CardPanel"
import { CardTile } from "../src/client/CardTile"
import { createBoardStore } from "../src/client/state/board"
import { createProjectListStore } from "../src/client/state/project-list"
import { createProjectStore } from "../src/client/state/projects"
import type { SnapshotStore } from "../src/client/state/store"
import type { TaskBoardResult } from "../src/client/types"
import {
  BOARD,
  CARD_ONE,
  CARD_TWO,
  fakeBridge,
  PROJECT,
  SNAPSHOT,
  translate,
} from "./client-support"

function fixed<T>(value: T): SnapshotStore<T> {
  return { getSnapshot: () => value, subscribe: () => () => {} }
}

function page(setup: (face: BoardPageInjected) => void = () => {}): string {
  const face: BoardPageInjected = {
    bridge: fakeBridge(),
    projects: createProjectStore(undefined),
    projectList: createProjectListStore(),
    board: createBoardStore(),
    locale: fixed("en"),
    clock: fixed(CARD_ONE.createdAt + 60_000),
    t: translate,
  }
  setup(face)
  return renderToStaticMarkup(createElement(BoardPage, face))
}

function ready(face: BoardPageInjected): void {
  face.projects.select(PROJECT.path)
  face.projectList.resolve(face.projectList.request(PROJECT.path), {
    status: "ok",
    value: [PROJECT],
  })
}

const ok = async (): Promise<TaskBoardResult<never>> => {
  throw new Error("not used in this render")
}

describe("board page rendering", () => {
  it("renders the project title, the columns and the cards", () => {
    const html = page((face) => {
      ready(face)
      face.board.load(PROJECT.path)
      face.board.receive(PROJECT.path, SNAPSHOT)
    })
    expect(html).toMatch(/<h1[^>]*>repo<\/h1>/)
    expect(html).toContain("To do")
    expect(html).toContain("In progress")
    expect(html).toContain("Shipped")
    expect(html).toContain("#1")
    expect(html).toContain("Write the bridge")
    expect(html).toContain("First line")
    expect(html).toContain("Add card")
    expect(html).toContain("Add column")
    expect(html).toContain('aria-label="Switch project"')
  })

  it("leaves out labels, hints and the old controls", () => {
    const html = page((face) => {
      ready(face)
      face.board.load(PROJECT.path)
      face.board.receive(PROJECT.path, SNAPSHOT)
    })
    for (const text of ["Task board", "Reload", "No cards", "Cards:", "Project", PROJECT.path]) {
      expect(html).not.toContain(text)
    }
  })

  it("shows skeleton columns while loading", () => {
    const html = page()
    expect(html).toContain("tb-skeleton")
    expect(html).not.toContain("Loading")
  })

  it("shows the empty state without projects", () => {
    const html = page((face) => {
      face.projectList.resolve(face.projectList.request(undefined), { status: "ok", value: [] })
    })
    expect(html).toContain("tb-empty")
    expect(html).toContain("No projects yet")
  })

  it("shows a board failure with a retry", () => {
    const html = page((face) => {
      ready(face)
      face.board.load(PROJECT.path)
      face.board.fail(PROJECT.path, { code: "transport", message: "offline" })
    })
    expect(html).toContain('role="alert"')
    expect(html).toContain("Could not load the board: offline")
    expect(html).toContain("Retry")
  })
})

describe("card tile rendering", () => {
  it("shows only what the card has, without words in the footer", () => {
    const html = renderToStaticMarkup(
      createElement(CardTile, {
        card: CARD_TWO,
        t: translate,
        open: false,
        dragging: false,
        onOpen: vi.fn(),
        onDragStart: vi.fn(),
        onDragEnd: vi.fn(),
        onKeyMove: vi.fn(),
      }),
    )
    expect(html).toContain("#2")
    expect(html).not.toContain("tb-card-detail")
    expect(html).not.toContain("tb-card-comments")
    expect(html).not.toContain("tb-card-linked")
    expect(html).not.toContain("Comments")
  })

  it("marks the open card and the dragged card", () => {
    const html = renderToStaticMarkup(
      createElement(CardTile, {
        card: CARD_ONE,
        t: translate,
        open: true,
        dragging: true,
        onOpen: vi.fn(),
        onDragStart: vi.fn(),
        onDragEnd: vi.fn(),
        onKeyMove: vi.fn(),
      }),
    )
    expect(html).toContain("tb-card-open")
    expect(html).toContain("tb-card-dragging")
    expect(html).toContain("tb-card-comments")
    expect(html).toContain("tb-card-linked")
    expect(html).toContain('data-card-number="1"')
  })
})

describe("card panel rendering", () => {
  it("renders the side sheet with the fields, the comments and the sessions", () => {
    const html = renderToStaticMarkup(
      createElement(CardPanel, {
        card: CARD_ONE,
        columns: BOARD.columns,
        t: translate,
        locale: "en",
        now: 1000 + 60_000,
        actions: {
          save: ok,
          moveTo: ok,
          addComment: ok,
          deleteComment: ok,
          unlinkSession: ok,
          deleteCard: ok,
        },
        onClose: vi.fn(),
      }),
    )
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="false"')
    expect(html).toContain("#1")
    expect(html).toContain('value="Write the bridge"')
    expect(html).toContain('placeholder="Description"')
    expect(html).toContain("Comments")
    expect(html).toContain("You")
    expect(html).toContain("1 minute ago")
    expect(html).toContain("Looks good")
    expect(html).toContain("Write a comment")
    expect(html).toContain("Sessions")
    expect(html).toContain("abcdef12")
    expect(html).toContain("To do")
    for (const text of ["Save", "No comments", "Post<", "Description (optional)"]) {
      expect(html).not.toContain(text)
    }
  })

  it("hides the sessions group when no session is linked", () => {
    const html = renderToStaticMarkup(
      createElement(CardPanel, {
        card: CARD_TWO,
        columns: BOARD.columns,
        t: translate,
        locale: "en",
        now: CARD_TWO.createdAt,
        actions: {
          save: ok,
          moveTo: ok,
          addComment: ok,
          deleteComment: ok,
          unlinkSession: ok,
          deleteCard: ok,
        },
        onClose: vi.fn(),
      }),
    )
    expect(html).not.toContain("Sessions")
  })
})
