import { describe, expect, it } from "vitest"
import { createTaskBoardService } from "../src/host/service"
import { createBoardStore } from "../src/host/store"
import type { BoardSnapshot, Card, TaskBoardOutcome } from "../src/shared/model"
import {
  buildBoard,
  createFakeResolver,
  createMemoryTables,
  ok,
  projectSummary,
} from "./host-support"

const PROJECT = projectSummary("/repo", { title: "Repo", workspaceId: "w1" })
const OTHER = projectSummary("/other", { title: "Other", workspaceId: "w2" })
const USER = { kind: "user" } as const
const AGENT = { kind: "agent", sessionId: "s1" } as const

function createHarness(projects = [PROJECT]) {
  const tables = createMemoryTables()
  const store = createBoardStore(tables.boards, tables.cards)
  let now = 1_000
  let sequence = 0
  const service = createTaskBoardService({
    store,
    resolver: createFakeResolver(projects, { "/repo/src": PROJECT }),
    clock: { now: () => now },
    ids: { next: () => `id-${++sequence}` },
  })
  return {
    service,
    store,
    at(value: number) {
      now = value
    },
  }
}

async function created(
  harness: ReturnType<typeof createHarness>,
  title = "Card",
  columnId?: string,
): Promise<Card> {
  const outcome = await harness.service.createCard(
    "/repo",
    { title, description: "", ...(columnId === undefined ? {} : { columnId }) },
    USER,
  )
  if (outcome.status !== "ok") throw new Error(outcome.error.message)
  return outcome.value
}

function valueOfOutcome<T>(outcome: TaskBoardOutcome<T>): T {
  if (outcome.status !== "ok") throw new Error(outcome.error.message)
  return outcome.value
}

function errorCode(outcome: TaskBoardOutcome<unknown>): string | undefined {
  return outcome.status === "error" ? outcome.error.code : undefined
}

describe("task board service", () => {
  it("lists the projects of the resolver", () => {
    const harness = createHarness([PROJECT, OTHER])
    expect(harness.service.projects()).toEqual([PROJECT, OTHER])
  })

  it("resolves a directory through the resolver", async () => {
    const harness = createHarness()
    await expect(harness.service.projectOfDirectory("/repo/src")).resolves.toEqual(ok(PROJECT))
    expect(errorCode(await harness.service.projectOfDirectory("/nope"))).toBe("project_not_found")
  })

  it("creates the default board on first access and keeps it", async () => {
    const harness = createHarness()

    const first = valueOfOutcome(await harness.service.snapshot("/repo"))
    const second = valueOfOutcome(await harness.service.snapshot("/repo"))

    expect(first).toEqual({
      board: buildBoard({ project: "/repo", createdAt: 1_000, updatedAt: 1_000 }),
      cards: [],
    })
    expect(second).toEqual(first)
    expect(harness.store.board("/repo")).toEqual(first.board)
  })

  it("returns project_not_found for an unknown project", async () => {
    const harness = createHarness()
    expect(errorCode(await harness.service.snapshot("/other"))).toBe("project_not_found")
  })

  it("creates a card in the first column by default", async () => {
    const harness = createHarness()

    const outcome = await harness.service.createCard(
      "/repo",
      { title: "  Fix the login form  ", description: "  The form drops spaces.  " },
      USER,
    )

    expect(outcome).toEqual(
      ok({
        project: "/repo",
        number: 1,
        title: "Fix the login form",
        description: "The form drops spaces.",
        comments: [],
        sessionIds: [],
        createdBy: USER,
        createdAt: 1_000,
        updatedAt: 1_000,
      }),
    )
    expect(harness.store.board("/repo")?.nextCardNumber).toBe(2)
    expect(harness.store.board("/repo")?.columns[0]?.cardNumbers).toEqual([1])
    expect(harness.store.card("/repo", 1)?.title).toBe("Fix the login form")
  })

  it("numbers the cards of a board in order", async () => {
    const harness = createHarness()
    await created(harness, "First")
    await created(harness, "Second")

    expect(
      (await harness.service.createCard("/repo", { title: "Third", description: "" }, USER)).status,
    ).toBe("ok")
    expect(harness.store.board("/repo")?.columns[0]?.cardNumbers).toEqual([1, 2, 3])
    expect(harness.store.board("/repo")?.nextCardNumber).toBe(4)
  })

  it("creates a card in the column the caller names", async () => {
    const harness = createHarness()
    const card = await created(harness, "Card", "done")

    expect(card.number).toBe(1)
    expect(harness.store.board("/repo")?.columns[2]?.cardNumbers).toEqual([1])
  })

  it("rejects an unknown column, an empty title, and an unknown project", async () => {
    const harness = createHarness()

    expect(
      errorCode(
        await harness.service.createCard(
          "/repo",
          { title: "Card", description: "", columnId: "nope" },
          USER,
        ),
      ),
    ).toBe("column_not_found")
    expect(
      await harness.service.createCard("/repo", { title: "   ", description: "" }, USER),
    ).toEqual({
      status: "error",
      error: { code: "invalid_input", message: "A card title must not be empty." },
    })
    expect(
      errorCode(
        await harness.service.createCard("/other", { title: "Card", description: "" }, USER),
      ),
    ).toBe("project_not_found")
  })

  it("updates the title and the description of a card", async () => {
    const harness = createHarness()
    await created(harness)
    harness.at(2_000)

    const titleOutcome = await harness.service.updateCard("/repo", 1, { title: "  New title  " })
    expect(valueOfOutcome(titleOutcome).title).toBe("New title")
    expect(valueOfOutcome(titleOutcome).updatedAt).toBe(2_000)

    harness.at(3_000)
    const descriptionOutcome = await harness.service.updateCard("/repo", 1, {
      description: "  New body  ",
    })
    expect(valueOfOutcome(descriptionOutcome).title).toBe("New title")
    expect(valueOfOutcome(descriptionOutcome).description).toBe("New body")
    expect(valueOfOutcome(descriptionOutcome).updatedAt).toBe(3_000)
  })

  it("rejects an empty update and a blank title", async () => {
    const harness = createHarness()
    await created(harness)

    expect(errorCode(await harness.service.updateCard("/repo", 1, {}))).toBe("invalid_input")
    expect(errorCode(await harness.service.updateCard("/repo", 1, { title: " " }))).toBe(
      "invalid_input",
    )
    expect(errorCode(await harness.service.updateCard("/repo", 2, { title: "x" }))).toBe(
      "card_not_found",
    )
  })

  it("reads one card and validates its number", async () => {
    const harness = createHarness()
    await created(harness)

    expect(valueOfOutcome(await harness.service.card("/repo", 1)).number).toBe(1)
    expect(errorCode(await harness.service.card("/repo", 9))).toBe("card_not_found")
    expect(errorCode(await harness.service.card("/repo", 0))).toBe("invalid_input")
    expect(errorCode(await harness.service.card("/repo", 1.5))).toBe("invalid_input")
  })

  it("lists the cards linked to one session", async () => {
    const harness = createHarness()
    await created(harness, "First")
    await created(harness, "Second")
    await harness.service.linkSession("/repo", 1, "s1")
    await harness.service.linkSession("/repo", 2, "s2")

    expect(
      valueOfOutcome(await harness.service.cardsOfSession("/repo", "s1")).map(
        (card) => card.number,
      ),
    ).toEqual([1])
    expect(
      valueOfOutcome(await harness.service.cardsOfSession("/repo", "s2")).map(
        (card) => card.number,
      ),
    ).toEqual([2])
    expect(valueOfOutcome(await harness.service.cardsOfSession("/repo", "s3"))).toEqual([])
    expect(errorCode(await harness.service.cardsOfSession("/repo", " "))).toBe("invalid_input")
  })

  it("moves a card to another column and appends it by default", async () => {
    const harness = createHarness()
    await created(harness, "First")
    await created(harness, "Second")
    await created(harness, "Third")

    const outcome = await harness.service.moveCard("/repo", 2, { columnId: "done" })

    expect(valueOfOutcome(outcome).number).toBe(2)
    expect(harness.store.board("/repo")?.columns[0]?.cardNumbers).toEqual([1, 3])
    expect(harness.store.board("/repo")?.columns[2]?.cardNumbers).toEqual([2])
  })

  it("inserts a moved card at the given index", async () => {
    const harness = createHarness()
    await created(harness, "First")
    await created(harness, "Second")
    await created(harness, "Third")

    await harness.service.moveCard("/repo", 3, { columnId: "todo", index: 0 })
    await harness.service.moveCard("/repo", 1, { columnId: "todo", index: 2 })

    expect(harness.store.board("/repo")?.columns[0]?.cardNumbers).toEqual([3, 2, 1])
  })

  it("validates the target column and the index of a move", async () => {
    const harness = createHarness()
    await created(harness)

    expect(errorCode(await harness.service.moveCard("/repo", 1, { columnId: "nope" }))).toBe(
      "column_not_found",
    )
    expect(errorCode(await harness.service.moveCard("/repo", 9, { columnId: "done" }))).toBe(
      "card_not_found",
    )
    expect(
      errorCode(await harness.service.moveCard("/repo", 1, { columnId: "done", index: -1 })),
    ).toBe("invalid_input")
    expect(await harness.service.moveCard("/repo", 1, { columnId: "done", index: 1 })).toEqual({
      status: "error",
      error: { code: "invalid_input", message: "The index 1 is outside the column (0 to 0)." },
    })
  })

  it("deletes a card and removes it from its column", async () => {
    const harness = createHarness()
    await created(harness, "First")
    await created(harness, "Second")

    expect(await harness.service.deleteCard("/repo", 1)).toEqual({ status: "ok", value: null })

    expect(harness.store.card("/repo", 1)).toBeUndefined()
    expect(harness.store.board("/repo")?.columns[0]?.cardNumbers).toEqual([2])
    expect(harness.store.board("/repo")?.nextCardNumber).toBe(3)
    expect(errorCode(await harness.service.deleteCard("/repo", 1))).toBe("card_not_found")
  })

  it("adds comments with the caller as author", async () => {
    const harness = createHarness()
    await created(harness)
    harness.at(2_000)

    const outcome = await harness.service.addComment("/repo", 1, "  I found the cause.  ", AGENT)

    expect(outcome).toEqual(
      ok({ id: "id-1", author: AGENT, body: "I found the cause.", createdAt: 2_000 }),
    )
    expect(harness.store.card("/repo", 1)?.comments).toEqual([valueOfOutcome(outcome)])
    expect(harness.store.card("/repo", 1)?.updatedAt).toBe(2_000)
  })

  it("rejects an empty comment and an unknown card", async () => {
    const harness = createHarness()
    await created(harness)

    expect(errorCode(await harness.service.addComment("/repo", 1, "  ", USER))).toBe(
      "invalid_input",
    )
    expect(errorCode(await harness.service.addComment("/repo", 9, "Body", USER))).toBe(
      "card_not_found",
    )
  })

  it("deletes one comment of a card", async () => {
    const harness = createHarness()
    await created(harness)
    const comment = valueOfOutcome(await harness.service.addComment("/repo", 1, "One", USER))
    valueOfOutcome(await harness.service.addComment("/repo", 1, "Two", USER))

    expect(await harness.service.deleteComment("/repo", 1, comment.id)).toEqual({
      status: "ok",
      value: null,
    })
    expect(harness.store.card("/repo", 1)?.comments.map((item) => item.body)).toEqual(["Two"])
    expect(errorCode(await harness.service.deleteComment("/repo", 1, comment.id))).toBe(
      "comment_not_found",
    )
  })

  it("links a session once and unlinks it", async () => {
    const harness = createHarness()
    await created(harness)

    expect(valueOfOutcome(await harness.service.linkSession("/repo", 1, "s1")).sessionIds).toEqual([
      "s1",
    ])
    expect(valueOfOutcome(await harness.service.linkSession("/repo", 1, "s1")).sessionIds).toEqual([
      "s1",
    ])
    expect(
      valueOfOutcome(await harness.service.unlinkSession("/repo", 1, "s1")).sessionIds,
    ).toEqual([])
    expect(
      valueOfOutcome(await harness.service.unlinkSession("/repo", 1, "s1")).sessionIds,
    ).toEqual([])
    expect(errorCode(await harness.service.linkSession("/repo", 1, " "))).toBe("invalid_input")
  })

  it("adds a column with a generated id", async () => {
    const harness = createHarness()

    const outcome = await harness.service.addColumn("/repo", "  Review  ")

    expect(outcome).toEqual(
      ok({ id: "id-1", title: { kind: "text", text: "Review" }, cardNumbers: [] }),
    )
    expect(harness.store.board("/repo")?.columns.map((column) => column.id)).toEqual([
      "todo",
      "in_progress",
      "done",
      "id-1",
    ])
    expect(errorCode(await harness.service.addColumn("/repo", " "))).toBe("invalid_input")
  })

  it("renames a column and turns a preset title into text", async () => {
    const harness = createHarness()

    const outcome = await harness.service.renameColumn("/repo", "todo", "  Backlog  ")

    expect(outcome).toEqual(
      ok({ id: "todo", title: { kind: "text", text: "Backlog" }, cardNumbers: [] }),
    )
    expect(harness.store.board("/repo")?.columns[0]?.title).toEqual({
      kind: "text",
      text: "Backlog",
    })
    expect(errorCode(await harness.service.renameColumn("/repo", "nope", "X"))).toBe(
      "column_not_found",
    )
    expect(errorCode(await harness.service.renameColumn("/repo", "todo", " "))).toBe(
      "invalid_input",
    )
  })

  it("moves a column to an index", async () => {
    const harness = createHarness()

    await harness.service.moveColumn("/repo", "done", 0)
    expect(harness.store.board("/repo")?.columns.map((column) => column.id)).toEqual([
      "done",
      "todo",
      "in_progress",
    ])

    await harness.service.moveColumn("/repo", "done", 2)
    expect(harness.store.board("/repo")?.columns.map((column) => column.id)).toEqual([
      "todo",
      "in_progress",
      "done",
    ])

    expect(errorCode(await harness.service.moveColumn("/repo", "todo", -1))).toBe("invalid_input")
    expect(errorCode(await harness.service.moveColumn("/repo", "todo", 3))).toBe("invalid_input")
    expect(errorCode(await harness.service.moveColumn("/repo", "nope", 0))).toBe("column_not_found")
  })

  it("deletes an empty column", async () => {
    const harness = createHarness()

    expect(await harness.service.deleteColumn("/repo", "done")).toEqual({
      status: "ok",
      value: null,
    })
    expect(harness.store.board("/repo")?.columns.map((column) => column.id)).toEqual([
      "todo",
      "in_progress",
    ])
  })

  it("refuses to delete a column that holds cards", async () => {
    const harness = createHarness()
    await created(harness, "Card", "done")

    const outcome = await harness.service.deleteColumn("/repo", "done")

    expect(errorCode(outcome)).toBe("column_not_empty")
    expect(harness.store.board("/repo")?.columns).toHaveLength(3)
  })

  it("refuses to delete the last column", async () => {
    const harness = createHarness()
    await harness.service.deleteColumn("/repo", "done")
    await harness.service.deleteColumn("/repo", "in_progress")

    expect(errorCode(await harness.service.deleteColumn("/repo", "todo"))).toBe("last_column")
    expect(harness.store.board("/repo")?.columns.map((column) => column.id)).toEqual(["todo"])
  })

  it("notifies the watchers of a project after each mutation", async () => {
    const harness = createHarness()
    const seen: BoardSnapshot[] = []
    const stop = harness.service.watch("/repo", (snapshot) => seen.push(snapshot))

    await created(harness, "First")
    await harness.service.card("/repo", 1)
    await created(harness, "Second")

    expect(seen).toHaveLength(2)
    expect(seen[1]?.cards.map((card) => card.title)).toEqual(["First", "Second"])
    expect(seen[1]?.board.columns[0]?.cardNumbers).toEqual([1, 2])

    stop()
    await created(harness, "Third")
    expect(seen).toHaveLength(2)
  })

  it("keeps working when a watcher throws", async () => {
    const harness = createHarness()
    const seen: BoardSnapshot[] = []
    harness.service.watch("/repo", () => {
      throw new Error("watcher failed")
    })
    harness.service.watch("/repo", (snapshot) => seen.push(snapshot))

    await expect(created(harness, "First")).resolves.toBeDefined()
    expect(seen).toHaveLength(1)
  })

  it("serializes concurrent writes to one board", async () => {
    const harness = createHarness()

    const cards = await Promise.all([
      created(harness, "First"),
      created(harness, "Second"),
      created(harness, "Third"),
    ])

    expect(cards.map((card) => card.number)).toEqual([1, 2, 3])
    expect(harness.store.board("/repo")?.columns[0]?.cardNumbers).toEqual([1, 2, 3])
  })

  it("stores a board under the canonical path of the project", async () => {
    const tables = createMemoryTables()
    const store = createBoardStore(tables.boards, tables.cards)
    const resolver = {
      projects: () => [PROJECT],
      project: (path: string) => (path === "/repo/" || path === "/repo" ? PROJECT : undefined),
      resolveDirectory: async () => ok(PROJECT),
    }
    const service = createTaskBoardService({
      store,
      resolver,
      clock: { now: () => 1_000 },
      ids: { next: () => "id-1" },
    })

    await service.createCard("/repo/", { title: "First", description: "" }, USER)

    expect(store.card("/repo", 1)?.title).toBe("First")
    expect(store.board("/repo")?.columns[0]?.cardNumbers).toEqual([1])
    expect(store.card("/repo/", 1)).toBeUndefined()
  })

  it("keeps the boards of different projects apart", async () => {
    const harness = createHarness([PROJECT, OTHER])
    await created(harness, "Repo card")

    const other = await harness.service.snapshot("/other")
    expect(valueOfOutcome(other).cards).toEqual([])
    expect(valueOfOutcome(other).board.columns[0]?.cardNumbers).toEqual([])
  })
})

describe("task board service errors", () => {
  const harness = createHarness()
  const cases: readonly [string, () => Promise<TaskBoardOutcome<unknown>>][] = [
    ["snapshot", () => harness.service.snapshot("/other")],
    ["card", () => harness.service.card("/other", 1)],
    ["cardsOfSession", () => harness.service.cardsOfSession("/other", "s1")],
    [
      "createCard",
      () => harness.service.createCard("/other", { title: "x", description: "" }, USER),
    ],
    ["updateCard", () => harness.service.updateCard("/other", 1, { title: "x" })],
    ["moveCard", () => harness.service.moveCard("/other", 1, { columnId: "done" })],
    ["deleteCard", () => harness.service.deleteCard("/other", 1)],
    ["addComment", () => harness.service.addComment("/other", 1, "x", USER)],
    ["deleteComment", () => harness.service.deleteComment("/other", 1, "c1")],
    ["linkSession", () => harness.service.linkSession("/other", 1, "s1")],
    ["unlinkSession", () => harness.service.unlinkSession("/other", 1, "s1")],
    ["addColumn", () => harness.service.addColumn("/other", "x")],
    ["renameColumn", () => harness.service.renameColumn("/other", "todo", "x")],
    ["moveColumn", () => harness.service.moveColumn("/other", "todo", 0)],
    ["deleteColumn", () => harness.service.deleteColumn("/other", "todo")],
  ]

  for (const [name, call] of cases) {
    it(`returns project_not_found for ${name}`, async () => {
      expect(errorCode(await call())).toBe("project_not_found")
    })
  }
})
