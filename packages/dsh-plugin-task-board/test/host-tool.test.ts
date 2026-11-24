import type { ToolRunContext } from "@deepseek-ai/dsh-tools"
import { ToolContextUnavailableError } from "@deepseek-ai/dsh-tools"
import { describe, expect, it } from "vitest"
import type { SessionDirectoryPort } from "../src/host/contract"
import { createTaskBoardService } from "../src/host/service"
import { createBoardStore } from "../src/host/store"
import { createTaskBoardTool } from "../src/host/tool"
import { createFakeResolver, createMemoryTables, projectSummary } from "./host-support"

const PROJECT = projectSummary("/repo", { title: "Repo", workspaceId: "w1" })
const USER = { kind: "user" } as const

interface ToolHarness {
  readonly tool: ReturnType<typeof createTaskBoardTool>
  readonly store: ReturnType<typeof createBoardStore>
  readonly service: ReturnType<typeof createTaskBoardService>
  readonly directories: { value: string }
  readonly roots: Map<string, string>
}

function createHarness(directories: { value: string } = { value: "/repo/src" }): ToolHarness {
  const tables = createMemoryTables()
  const store = createBoardStore(tables.boards, tables.cards)
  const service = createTaskBoardService({
    store,
    resolver: createFakeResolver([PROJECT], { "/repo/src": PROJECT }),
    clock: { now: () => 1_000 },
    ids: { next: () => "id-1" },
  })
  const roots = new Map<string, string>()
  const sessions: Pick<SessionDirectoryPort, "rootSessionOf"> = {
    rootSessionOf: (sessionId) => roots.get(sessionId) ?? sessionId,
  }
  const tool = createTaskBoardTool({
    service,
    sessions,
    directoryOfSession: () => directories.value,
  })
  return { tool, store, service, directories, roots }
}

function exec(sessionId = "s1"): ToolRunContext {
  return {
    agent: { id: sessionId, session: { id: sessionId } },
    signal: new AbortController().signal,
    callId: "call-1",
  } as unknown as ToolRunContext
}

async function call(
  harness: ToolHarness,
  args: Record<string, unknown>,
  sessionId = "s1",
): Promise<string> {
  const value = (await harness.tool.execute(args, exec(sessionId))) as { text: string }
  return value.text
}

async function seed(harness: ToolHarness): Promise<void> {
  const first = await harness.service.createCard(
    "/repo",
    { title: "First", description: "The first card." },
    USER,
  )
  if (first.status !== "ok") throw new Error(first.error.message)
  const second = await harness.service.createCard(
    "/repo",
    { title: "Second", description: "", columnId: "done" },
    USER,
  )
  if (second.status !== "ok") throw new Error(second.error.message)
}

describe("task board tool", () => {
  it("is named task_board and explains the board", () => {
    const harness = createHarness()

    expect(harness.tool.name).toBe("task_board")
    expect(harness.tool.description).toContain("task board")
    expect(harness.tool.description).toContain("get")
    expect(harness.tool.description).toContain("comment")
    expect(harness.tool.parameters).toMatchObject({
      properties: {
        action: { enum: ["list", "get", "create", "update", "move", "comment"] },
        number: { type: "integer" },
      },
      required: ["action"],
    })
  })

  it("lists every column and marks the cards linked to this session", async () => {
    const harness = createHarness()
    await seed(harness)
    const linked = await harness.service.linkSession("/repo", 1, "s1")
    if (linked.status !== "ok") throw new Error(linked.error.message)

    await expect(call(harness, { action: "list" })).resolves.toBe(
      [
        "Task board of /repo",
        "",
        "To do",
        "  #1 First (linked to this session)",
        "",
        "In progress",
        "",
        "Done",
        "  #2 Second",
      ].join("\n"),
    )
  })

  it("shows one card in full", async () => {
    const harness = createHarness()
    await seed(harness)
    const comment = await harness.service.addComment("/repo", 1, "Please check the tokenizer.", {
      kind: "user",
    })
    if (comment.status !== "ok") throw new Error(comment.error.message)
    const linked = await harness.service.linkSession("/repo", 1, "s1")
    if (linked.status !== "ok") throw new Error(linked.error.message)

    await expect(call(harness, { action: "get", number: 1 })).resolves.toBe(
      [
        "#1 First",
        "Column: To do",
        "",
        "Description:",
        "The first card.",
        "",
        "Comments:",
        "- user, 1970-01-01T00:00:01.000Z: Please check the tokenizer.",
        "",
        "Linked sessions:",
        "- s1 (this session)",
      ].join("\n"),
    )
  })

  it("reports no linked card when the session has none", async () => {
    const harness = createHarness()
    await seed(harness)

    await expect(call(harness, { action: "get" })).resolves.toBe(
      "No card is linked to this session.",
    )
  })

  it("finds a card linked to the root session", async () => {
    const harness = createHarness()
    await seed(harness)
    harness.roots.set("s1", "root")
    const linked = await harness.service.linkSession("/repo", 2, "root")
    if (linked.status !== "ok") throw new Error(linked.error.message)

    const text = await call(harness, { action: "get" })

    expect(text).toContain("#2 Second")
    expect(text).toContain("- root")
  })

  it("fails on an unknown card", async () => {
    const harness = createHarness()
    await seed(harness)

    await expect(call(harness, { action: "get", number: 9 })).rejects.toThrow(
      "Card #9 does not exist in this project.",
    )
  })

  it("creates a card in the first column", async () => {
    const harness = createHarness()

    await expect(call(harness, { action: "create", title: "New card" })).resolves.toBe(
      'Created card #1 "New card" in column "To do".',
    )
    expect(harness.store.card("/repo", 1)).toMatchObject({
      title: "New card",
      createdBy: { kind: "agent", sessionId: "s1" },
      sessionIds: [],
    })
    expect(harness.store.board("/repo")?.columns[0]?.cardNumbers).toEqual([1])
  })

  it("creates a card in a column named by id or title", async () => {
    const harness = createHarness()

    await expect(
      call(harness, { action: "create", title: "In done", column: "done" }),
    ).resolves.toBe('Created card #1 "In done" in column "Done".')
    await expect(
      call(harness, { action: "create", title: "In progress", column: "in progress" }),
    ).resolves.toBe('Created card #2 "In progress" in column "In progress".')
    expect(harness.store.board("/repo")?.columns[1]?.cardNumbers).toEqual([2])
    expect(harness.store.board("/repo")?.columns[2]?.cardNumbers).toEqual([1])
  })

  it("refuses an unknown column and a missing title", async () => {
    const harness = createHarness()

    await expect(
      call(harness, { action: "create", title: "Card", column: "nope" }),
    ).rejects.toThrow('Column "nope" does not exist in this board.')
    await expect(call(harness, { action: "create" })).rejects.toThrow(
      "The create action needs a title.",
    )
  })

  it("updates the title or the description of a card", async () => {
    const harness = createHarness()
    await seed(harness)

    await expect(call(harness, { action: "update", number: 1, title: "Changed" })).resolves.toBe(
      'Updated card #1 "Changed".',
    )
    await expect(
      call(harness, { action: "update", number: 1, description: "New body" }),
    ).resolves.toBe('Updated card #1 "Changed".')
    expect(harness.store.card("/repo", 1)?.description).toBe("New body")
    await expect(call(harness, { action: "update", number: 1 })).rejects.toThrow(
      "The update action needs a title, a description, or both.",
    )
    await expect(call(harness, { action: "update", title: "Changed" })).rejects.toThrow(
      "The update action needs a card number.",
    )
  })

  it("moves a card to a column named by id or title", async () => {
    const harness = createHarness()
    await seed(harness)

    await expect(call(harness, { action: "move", number: 1, column: "Done" })).resolves.toBe(
      'Moved card #1 to column "Done".',
    )
    expect(harness.store.board("/repo")?.columns[2]?.cardNumbers).toEqual([2, 1])
    await expect(call(harness, { action: "move", number: 1 })).rejects.toThrow(
      "The move action needs a column.",
    )
    await expect(call(harness, { action: "move", column: "Done" })).rejects.toThrow(
      "The move action needs a card number.",
    )
  })

  it("adds a comment as the calling agent", async () => {
    const harness = createHarness()
    await seed(harness)

    await expect(
      call(harness, { action: "comment", number: 1, body: "Working on it." }),
    ).resolves.toBe("Added a comment to card #1.")
    expect(harness.store.card("/repo", 1)?.comments).toEqual([
      {
        id: "id-1",
        author: { kind: "agent", sessionId: "s1" },
        body: "Working on it.",
        createdAt: 1_000,
      },
    ])
    await expect(call(harness, { action: "comment", number: 1 })).rejects.toThrow(
      "The comment action needs a body.",
    )
    await expect(call(harness, { action: "comment", body: "Body" })).rejects.toThrow(
      "The comment action needs a card number.",
    )
  })

  it("fails when no project contains the working directory", async () => {
    const harness = createHarness({ value: "/elsewhere" })

    await expect(call(harness, { action: "list" })).rejects.toThrow(
      "No project is registered for /elsewhere.",
    )
  })

  it("needs a calling agent", async () => {
    const harness = createHarness()
    const withoutAgent = {
      signal: new AbortController().signal,
      callId: "call-2",
    } as unknown as ToolRunContext

    await expect(harness.tool.execute({ action: "list" }, withoutAgent)).rejects.toBeInstanceOf(
      ToolContextUnavailableError,
    )
  })

  it("rejects an unknown action before running", async () => {
    const harness = createHarness()

    await expect(harness.tool.execute({ action: "delete" }, exec())).rejects.toThrow(/action/u)
  })
})
