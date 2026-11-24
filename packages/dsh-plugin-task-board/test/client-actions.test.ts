import { describe, expect, it, vi } from "vitest"
import { createBoardActions, createCardActions } from "../src/client/actions"
import type { TaskBoardFailure } from "../src/client/types"
import { BOARD, CARD_ONE, fakeBridge, PROJECT } from "./client-support"

const NOPE = { code: "invalid_input", message: "nope" }

describe("board actions", () => {
  it("creates a card in a column and reports success", async () => {
    const createCard = vi.fn(async () => ({ status: "ok" as const, value: CARD_ONE }))
    const report = vi.fn<(failure: TaskBoardFailure | undefined) => void>()
    const actions = createBoardActions(fakeBridge({ createCard }), PROJECT.path, report)
    expect(await actions.createCard("todo", "Write")).toBe(true)
    expect(createCard).toHaveBeenCalledWith(PROJECT.path, {
      title: "Write",
      description: "",
      columnId: "todo",
    })
    expect(report).toHaveBeenCalledWith(undefined)
  })

  it("reports a failure and answers false", async () => {
    const report = vi.fn<(failure: TaskBoardFailure | undefined) => void>()
    const actions = createBoardActions(
      fakeBridge({ addColumn: async () => ({ status: "error", error: NOPE }) }),
      PROJECT.path,
      report,
    )
    expect(await actions.addColumn("Review")).toBe(false)
    expect(report).toHaveBeenCalledWith(NOPE)
  })

  it("moves a card to a place or to the end of a column", async () => {
    const moveCard = vi.fn(async () => ({ status: "ok" as const, value: CARD_ONE }))
    const actions = createBoardActions(fakeBridge({ moveCard }), PROJECT.path, () => {})
    await actions.moveCard(1, "done", 0)
    await actions.moveCard(1, "done", undefined)
    expect(moveCard).toHaveBeenNthCalledWith(1, PROJECT.path, 1, { columnId: "done", index: 0 })
    expect(moveCard).toHaveBeenNthCalledWith(2, PROJECT.path, 1, { columnId: "done" })
  })

  it("renames, moves and deletes columns", async () => {
    const column = BOARD.columns[0]
    if (column === undefined) throw new Error("expected a column")
    const renameColumn = vi.fn(async () => ({ status: "ok" as const, value: column }))
    const moveColumn = vi.fn(async () => ({ status: "ok" as const, value: BOARD }))
    const deleteColumn = vi.fn(async () => ({ status: "ok" as const, value: null }))
    const actions = createBoardActions(
      fakeBridge({ renameColumn, moveColumn, deleteColumn }),
      PROJECT.path,
      () => {},
    )
    expect(await actions.renameColumn("todo", "Backlog")).toBe(true)
    expect(await actions.moveColumn("todo", 1)).toBe(true)
    expect(await actions.deleteColumn("in_progress")).toBe(true)
    expect(renameColumn).toHaveBeenCalledWith(PROJECT.path, "todo", "Backlog")
    expect(moveColumn).toHaveBeenCalledWith(PROJECT.path, "todo", 1)
    expect(deleteColumn).toHaveBeenCalledWith(PROJECT.path, "in_progress")
  })
})

describe("card actions", () => {
  it("sends every card change to the project", async () => {
    const updateCard = vi.fn(async () => ({ status: "ok" as const, value: CARD_ONE }))
    const moveCard = vi.fn(async () => ({ status: "ok" as const, value: CARD_ONE }))
    const addComment = vi.fn(async () => ({
      status: "ok" as const,
      value: { id: "c", author: { kind: "user" as const }, body: "Hi", createdAt: 1 },
    }))
    const deleteComment = vi.fn(async () => ({ status: "ok" as const, value: null }))
    const unlinkSession = vi.fn(async () => ({ status: "ok" as const, value: CARD_ONE }))
    const deleteCard = vi.fn(async () => ({ status: "ok" as const, value: null }))
    const actions = createCardActions(
      fakeBridge({ updateCard, moveCard, addComment, deleteComment, unlinkSession, deleteCard }),
      PROJECT.path,
    )
    await actions.save(1, { title: "New" })
    await actions.moveTo(1, "done")
    await actions.addComment(1, "Hi")
    await actions.deleteComment(1, "c")
    await actions.unlinkSession(1, "s")
    await actions.deleteCard(1)
    expect(updateCard).toHaveBeenCalledWith(PROJECT.path, 1, { title: "New" })
    expect(moveCard).toHaveBeenCalledWith(PROJECT.path, 1, { columnId: "done" })
    expect(addComment).toHaveBeenCalledWith(PROJECT.path, 1, "Hi")
    expect(deleteComment).toHaveBeenCalledWith(PROJECT.path, 1, "c")
    expect(unlinkSession).toHaveBeenCalledWith(PROJECT.path, 1, "s")
    expect(deleteCard).toHaveBeenCalledWith(PROJECT.path, 1)
  })
})
