import type { CommandDefinition, CommandInvocation } from "@deepseek-ai/dsh-commands"
import type { UserMessage } from "@deepseek-ai/dsh-session"
import { describe, expect, it } from "vitest"
import {
  createTaskCommandHandler,
  parseCardNumber,
  registerTaskCommand,
  TASK_COMMAND_USAGE,
} from "../src/host/command"
import { buildCardMessage } from "../src/host/message"
import { createTaskBoardService } from "../src/host/service"
import { createBoardStore } from "../src/host/store"
import { createFakeResolver, createMemoryTables, projectSummary } from "./host-support"

const PROJECT = projectSummary("/repo", { title: "Repo", workspaceId: "w1" })

function createHarness(directory = "/repo/src") {
  const tables = createMemoryTables()
  const store = createBoardStore(tables.boards, tables.cards)
  const service = createTaskBoardService({
    store,
    resolver: createFakeResolver([PROJECT], { "/repo/src": PROJECT }),
    clock: { now: () => 1_000 },
    ids: { next: () => "id-1" },
  })
  const followups: UserMessage[] = []
  const directories = { value: directory }
  const handler = createTaskCommandHandler({
    service,
    directoryOfSession: () => directories.value,
  })
  return { store, service, followups, directories, handler }
}

function invocation(
  rawInput: string,
  followups: UserMessage[],
  sessionId = "s1",
): CommandInvocation {
  return {
    commandId: "command-1",
    agent: {
      id: sessionId,
      session: { id: sessionId },
      followup: (message: UserMessage) => followups.push(message),
    },
    rawInput,
    attachments: [],
    signal: new AbortController().signal,
  } as unknown as CommandInvocation
}

describe("parseCardNumber", () => {
  it("accepts a number with or without a hash", () => {
    expect(parseCardNumber("12")).toBe(12)
    expect(parseCardNumber("#12")).toBe(12)
    expect(parseCardNumber("  #7  ")).toBe(7)
  })

  it("rejects anything else", () => {
    expect(parseCardNumber("")).toBeUndefined()
    expect(parseCardNumber("abc")).toBeUndefined()
    expect(parseCardNumber("0")).toBeUndefined()
    expect(parseCardNumber("#0")).toBeUndefined()
    expect(parseCardNumber("-1")).toBeUndefined()
    expect(parseCardNumber("1.5")).toBeUndefined()
    expect(parseCardNumber("12 34")).toBeUndefined()
  })
})

describe("task command handler", () => {
  it("sends the card to the agent and links the session", async () => {
    const harness = createHarness()
    const card = await harness.service.createCard(
      "/repo",
      { title: "First", description: "The first card." },
      { kind: "user" },
    )
    if (card.status !== "ok") throw new Error(card.error.message)

    const result = await harness.handler(invocation("1", harness.followups))

    expect(result).toEqual({ kind: "success", text: 'Sent #1 "First" to the agent.' })
    expect(harness.followups).toHaveLength(1)
    expect(harness.followups[0]?.content).toEqual([
      { type: "text", text: buildCardMessage(card.value, "To do") },
    ])
    expect(harness.store.card("/repo", 1)?.sessionIds).toEqual(["s1"])
    expect(harness.store.board("/repo")?.columns[0]?.cardNumbers).toEqual([1])
  })

  it("accepts the hash form", async () => {
    const harness = createHarness()
    await harness.service.createCard("/repo", { title: "First", description: "" }, { kind: "user" })

    const result = await harness.handler(invocation("#1", harness.followups))

    expect(result).toEqual({ kind: "success", text: 'Sent #1 "First" to the agent.' })
  })

  it("returns a usage error when the input is not a card number", async () => {
    const harness = createHarness()

    const result = await harness.handler(invocation("abc", harness.followups))

    expect(result).toEqual({ kind: "error", text: TASK_COMMAND_USAGE })
    expect(harness.followups).toHaveLength(0)
  })

  it("reports an unknown card", async () => {
    const harness = createHarness()

    const result = await harness.handler(invocation("9", harness.followups))

    expect(result).toEqual({
      kind: "error",
      text: "Card #9 does not exist in this project.",
    })
    expect(harness.followups).toHaveLength(0)
  })

  it("reports a directory outside every project", async () => {
    const harness = createHarness()
    harness.directories.value = "/elsewhere"

    const result = await harness.handler(invocation("1", harness.followups))

    expect(result).toEqual({
      kind: "error",
      text: "No project is registered for /elsewhere.",
    })
  })
})

describe("registerTaskCommand", () => {
  it("registers the task command with an input hint", () => {
    const registered: CommandDefinition[] = []
    const harness = createHarness()

    registerTaskCommand(
      {
        register: (definition) => {
          registered.push(definition)
          return () => {}
        },
      },
      { service: harness.service, directoryOfSession: () => "/repo/src" },
    )

    expect(registered).toHaveLength(1)
    expect(registered[0]).toMatchObject({
      name: "task",
      description: "Send a task board card to the agent of this session",
      input: { hint: "<card number>" },
    })
  })
})
