import { describe, expect, it } from "vitest"
import { boardKey, cardKey, createBoardStore } from "../src/host/store"
import { buildBoard, buildCard, createMemoryTables } from "./host-support"

const PATH_SAFE_KEY = /^[a-zA-Z0-9_-]+$/

describe("boardKey", () => {
  it("is a path-safe key that differs for each project", () => {
    expect(boardKey("/home/me/repo")).toMatch(PATH_SAFE_KEY)
    expect(boardKey("C:\\work\\repo")).toMatch(PATH_SAFE_KEY)
    expect(boardKey("/repo")).not.toBe(boardKey("/repo2"))
    expect(boardKey("/repo")).toBe(boardKey("/repo"))
  })
})

describe("cardKey", () => {
  it("is a path-safe key that separates the project from the number", () => {
    expect(cardKey("/home/me/repo", 12)).toMatch(PATH_SAFE_KEY)
    expect(cardKey("/repo", 1)).not.toBe(cardKey("/repo2", 1))
    expect(cardKey("/repo", 1)).not.toBe(cardKey("/repo", 11))
    expect(cardKey("/repo", 1)).toBe(cardKey("/repo", 1))
  })
})

describe("createBoardStore", () => {
  it("reads and writes a board by its project", async () => {
    const tables = createMemoryTables()
    const store = createBoardStore(tables.boards, tables.cards)
    expect(store.board("/repo")).toBeUndefined()
    const board = buildBoard()
    await store.saveBoard(board)
    expect(store.board("/repo")).toEqual(board)
    expect(tables.boards.get(boardKey("/repo"))).toEqual(board)
  })

  it("keeps the cards of each project apart", async () => {
    const tables = createMemoryTables()
    const store = createBoardStore(tables.boards, tables.cards)
    await store.saveCard(buildCard({ project: "/repo", number: 1 }))
    await store.saveCard(buildCard({ project: "/repo2", number: 1, title: "Other" }))

    expect(store.card("/repo", 1)?.title).toBe("Fix the login form")
    expect(store.card("/repo2", 1)?.title).toBe("Other")
    expect(store.cards("/repo").map((card) => card.title)).toEqual(["Fix the login form"])
  })

  it("lists the cards of a project in number order", async () => {
    const tables = createMemoryTables()
    const store = createBoardStore(tables.boards, tables.cards)
    await store.saveCard(buildCard({ number: 3, title: "Third" }))
    await store.saveCard(buildCard({ number: 1, title: "First" }))
    await store.saveCard(buildCard({ number: 2, title: "Second" }))

    expect(store.cards("/repo").map((card) => card.number)).toEqual([1, 2, 3])
    expect(store.card("/repo", 2)?.title).toBe("Second")
    expect(store.card("/repo", 9)).toBeUndefined()
  })

  it("deletes one card and keeps the others", async () => {
    const tables = createMemoryTables()
    const store = createBoardStore(tables.boards, tables.cards)
    await store.saveCard(buildCard({ number: 1 }))
    await store.saveCard(buildCard({ number: 2 }))

    await store.deleteCard("/repo", 1)

    expect(store.card("/repo", 1)).toBeUndefined()
    expect(store.cards("/repo").map((card) => card.number)).toEqual([2])
  })

  it("deletes a card of another project without touching this one", async () => {
    const tables = createMemoryTables()
    const store = createBoardStore(tables.boards, tables.cards)
    await store.saveCard(buildCard({ project: "/repo", number: 1 }))
    await store.saveCard(buildCard({ project: "/repo2", number: 1 }))

    await store.deleteCard("/repo2", 1)

    expect(store.card("/repo", 1)).toBeDefined()
    expect(store.card("/repo2", 1)).toBeUndefined()
  })
})
