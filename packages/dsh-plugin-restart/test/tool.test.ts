import type { Agent } from "@deepseek-ai/dsh-agent"
import type { ToolDefinition, ToolRegistrationOptions } from "@deepseek-ai/dsh-tools"
import { describe, expect, it, vi } from "vitest"
import type { AgentPort } from "../src/contract"
import type { RestartCoordinator } from "../src/host/coordinator"
import { registerRestartTool } from "../src/host/tool"

interface FixtureOptions {
  canExit?: boolean
  preset?: string
  rootId?: string
  refuse?: string
}

function createFixture(options: FixtureOptions = {}) {
  const registered: {
    definition: ToolDefinition
    options: ToolRegistrationOptions | undefined
  }[] = []
  const requests: { caller: AgentPort; note: string | undefined }[] = []
  const coordinator = {
    request: (caller: AgentPort, note: string | undefined) => {
      if (options.refuse !== undefined) throw new Error(options.refuse)
      requests.push({ caller, note })
    },
  } as unknown as RestartCoordinator
  const caller: AgentPort = {
    id: "a1",
    sessionId: "s1",
    status: () => "running",
    whenIdle: async () => {},
    followup: () => {},
  }
  const agent = { id: "a1" } as Agent
  const ctx = {
    tools: {
      register: (definition: ToolDefinition, registration: ToolRegistrationOptions | undefined) => {
        registered.push({ definition, options: registration })
      },
    },
  }
  registerRestartTool(ctx as never, {
    presets: ["cordis"],
    coordinator,
    canExit: () => options.canExit ?? true,
    factsOf: () => ({
      agentId: "a1",
      rootAgentId: options.rootId ?? "a1",
      preset: options.preset ?? "cordis",
    }),
    agentOf: () => caller,
  })
  const definition = registered[0]?.definition as ToolDefinition
  return { registered, requests, caller, agent, definition }
}

describe("restart tool", () => {
  it("registers one restart_harness tool", () => {
    const fixture = createFixture()
    expect(fixture.registered).toHaveLength(1)
    expect(fixture.definition.name).toBe("restart_harness")
    expect(fixture.definition.description).toContain("restart")
  })

  it("offers the tool to a root Creator session", async () => {
    const fixture = createFixture()
    expect(await fixture.registered[0]?.options?.when?.({ agent: fixture.agent } as never)).toBe(
      true,
    )
  })

  it("withholds the tool when the launcher cannot exit", async () => {
    const fixture = createFixture({ canExit: false })
    expect(await fixture.registered[0]?.options?.when?.({ agent: fixture.agent } as never)).toBe(
      false,
    )
  })

  it("withholds the tool from a sub-agent", async () => {
    const fixture = createFixture({ rootId: "root" })
    expect(await fixture.registered[0]?.options?.when?.({ agent: fixture.agent } as never)).toBe(
      false,
    )
  })

  it("withholds the tool from another preset", async () => {
    const fixture = createFixture({ preset: "standard" })
    expect(await fixture.registered[0]?.options?.when?.({ agent: fixture.agent } as never)).toBe(
      false,
    )
  })

  it("needs a live agent", async () => {
    const fixture = createFixture()
    await expect(fixture.definition.execute({}, { agent: undefined } as never)).rejects.toThrow(
      /live agent/,
    )
  })

  it("refuses a caller outside a Creator preset", async () => {
    const fixture = createFixture({ preset: "standard" })
    await expect(
      fixture.definition.execute({}, { agent: fixture.agent, concludeTurn: vi.fn() } as never),
    ).rejects.toThrow(/Creator/)
  })

  it("hands the note to the coordinator and ends the turn", async () => {
    const fixture = createFixture()
    const concludeTurn = vi.fn()
    const result = (await fixture.definition.execute({ resume_note: "run the tests" }, {
      agent: fixture.agent,
      concludeTurn,
    } as never)) as { restarting: boolean; message: string }
    expect(fixture.requests).toEqual([{ caller: fixture.caller, note: "run the tests" }])
    expect(concludeTurn).toHaveBeenCalledTimes(1)
    expect(result.restarting).toBe(true)
    expect(result.message).toMatch(/restarts after this turn ends/)
    expect(result.message).toMatch(/resumes automatically/)
  })

  it("passes a refusal from the coordinator through and keeps the turn open", async () => {
    const fixture = createFixture({ refuse: "another session is running" })
    const concludeTurn = vi.fn()
    await expect(
      fixture.definition.execute({}, { agent: fixture.agent, concludeTurn } as never),
    ).rejects.toThrow(/another session is running/)
    expect(concludeTurn).not.toHaveBeenCalled()
  })
})
