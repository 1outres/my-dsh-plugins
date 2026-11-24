import { describe, expect, it, vi } from "vitest"
import { runTaskCommand } from "../src/client/task-command"
import type { CommandsRemote } from "../src/client/types"
import { translate } from "./client-support"

function commands(execute: CommandsRemote["execute"]): {
  remote: CommandsRemote
  execute: ReturnType<typeof vi.fn>
} {
  const spy = vi.fn(execute)
  return { remote: { execute: spy }, execute: spy }
}

describe("runTaskCommand", () => {
  it("runs /task with the chosen number", async () => {
    const test = commands(async () => ({
      ok: true,
      value: { result: { kind: "success" } },
    }))
    await runTaskCommand({
      commands: test.remote,
      sessionId: "session-1",
      optionId: "4",
      t: translate,
    })
    expect(test.execute).toHaveBeenCalledWith("session-1", "/task 4", [])
  })

  it("reports a refused call", async () => {
    const test = commands(async () => ({
      ok: false,
      error: { code: "gateway/internal", message: "offline" },
    }))
    await expect(
      runTaskCommand({
        commands: test.remote,
        sessionId: "session-1",
        optionId: "4",
        t: translate,
      }),
    ).rejects.toThrow("Could not start the task: offline")
  })

  it("reports an unknown command", async () => {
    const test = commands(async () => ({ ok: true, value: undefined }))
    await expect(
      runTaskCommand({
        commands: test.remote,
        sessionId: "session-1",
        optionId: "4",
        t: translate,
      }),
    ).rejects.toThrow("The Host does not know the /task command.")
  })

  it("reports a command handler error", async () => {
    const test = commands(async () => ({
      ok: true,
      value: { result: { kind: "error", text: "no such card" } },
    }))
    await expect(
      runTaskCommand({
        commands: test.remote,
        sessionId: "session-1",
        optionId: "4",
        t: translate,
      }),
    ).rejects.toThrow("Could not start the task: no such card")
  })

  it("rejects an invalid option before calling the Host", async () => {
    const test = commands(async () => ({
      ok: true,
      value: { result: { kind: "success" } },
    }))
    await expect(
      runTaskCommand({
        commands: test.remote,
        sessionId: "session-1",
        optionId: "nope",
        t: translate,
      }),
    ).rejects.toThrow("The card number is not valid: nope")
    expect(test.execute).not.toHaveBeenCalled()
  })
})
