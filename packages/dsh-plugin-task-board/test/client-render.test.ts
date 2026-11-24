import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { BoardPage } from "../src/client/BoardPage"
import type { TaskBoardBridge } from "../src/client/bridge"
import { CardDialog } from "../src/client/CardDialog"
import { createBoardStore } from "../src/client/state/board"
import { createProjectStore } from "../src/client/state/projects"
import type { TaskBoardResult } from "../src/client/types"
import { CARD_ONE, PROJECT, SNAPSHOT, translate } from "./client-support"

function bridge(): TaskBoardBridge {
  const unused = async (): Promise<TaskBoardResult<never>> => {
    throw new Error("not used in this render")
  }
  return {
    projects: async () => ({ status: "ok", value: [PROJECT] }),
    projectOfSession: unused,
    boardOfSession: unused,
    createCard: unused,
    updateCard: unused,
    moveCard: unused,
    deleteCard: unused,
    addComment: unused,
    deleteComment: unused,
    unlinkSession: unused,
    addColumn: unused,
    renameColumn: unused,
    moveColumn: unused,
    deleteColumn: unused,
    watch: () => () => {},
    dispose: () => {},
  }
}

describe("board page rendering", () => {
  it("renders the columns and cards of the selected project", () => {
    const projects = createProjectStore(undefined)
    projects.select(PROJECT.path)
    const board = createBoardStore()
    board.load(PROJECT.path)
    board.receive(PROJECT.path, SNAPSHOT)
    const html = renderToStaticMarkup(
      createElement(BoardPage, { bridge: bridge(), projects, board, t: translate }),
    )
    expect(html).toContain("Task board")
    expect(html).toContain("To do")
    expect(html).toContain("In progress")
    expect(html).toContain("Shipped")
    expect(html).toContain("#1")
    expect(html).toContain("Write the bridge")
    expect(html).toContain("First line")
    expect(html).toContain("Add card")
    expect(html).toContain("Add column")
  })

  it("renders the card dialog with comments, links and the delete step", () => {
    const comment = CARD_ONE.comments[0]
    if (comment === undefined) throw new Error("expected a comment")
    const html = renderToStaticMarkup(
      createElement(CardDialog, {
        card: CARD_ONE,
        t: translate,
        actions: {
          save: async () => ({ status: "ok" as const, value: CARD_ONE }),
          addComment: async () => ({ status: "ok" as const, value: comment }),
          deleteComment: async () => ({ status: "ok" as const, value: null }),
          unlinkSession: async () => ({ status: "ok" as const, value: CARD_ONE }),
          deleteCard: async () => ({ status: "ok" as const, value: null }),
        },
        onClose: vi.fn(),
        onDeleted: vi.fn(),
      }),
    )
    expect(html).toContain("Comments")
    expect(html).toContain("You")
    expect(html).toContain("abcdef12")
    expect(html).toContain("Delete card")
    expect(html).toContain("Save")
  })
})
