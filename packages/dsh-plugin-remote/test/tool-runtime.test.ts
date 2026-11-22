import type { Context } from "@deepseek-ai/cordis"
import type { Agent } from "@deepseek-ai/dsh-agent"
import type { ToolRunContext } from "@deepseek-ai/dsh-tools"
import { describe, expect, it } from "vitest"
import type { HostRuntime, RootRuntime } from "../src/host/runtime"
import { requireUserCard, runtimeFor } from "../src/host/tools/common"

const root = { id: "root" } as Agent
const child = { id: "child" } as Agent

function contextWith(rootOf: (caller: Agent) => Agent): Context {
  return { subagents: { rootOf } } as unknown as Context
}

function hostFor(seen: Agent[]): HostRuntime {
  return {
    runtimeFor: (agent: Agent) => {
      seen.push(agent)
      return { root: agent, sessionId: agent.id } as unknown as RootRuntime
    },
  } as unknown as HostRuntime
}

function execOf(agent: Agent): ToolRunContext {
  return { agent, signal: new AbortController().signal } as ToolRunContext
}

describe("runtimeFor", () => {
  it("uses the agent itself when it is a tree root", () => {
    const seen: Agent[] = []
    const result = runtimeFor(
      contextWith((caller) => caller),
      hostFor(seen),
      execOf(root),
    )
    expect(seen).toEqual([root])
    expect(result.delegated).toBe(false)
    expect(result.agent).toBe(root)
  })

  it("shares the root runtime with a subagent", () => {
    const seen: Agent[] = []
    const result = runtimeFor(
      contextWith((caller) => (caller === child ? root : caller)),
      hostFor(seen),
      execOf(child),
    )
    expect(seen).toEqual([root])
    expect(result.delegated).toBe(true)
    expect(result.agent).toBe(child)
    expect(() => requireUserCard(result.runtime, result.agent)).toThrow(
      "A sub-agent cannot wait for the user",
    )
  })

  it("passes on the error of a caller without a live tree", () => {
    const seen: Agent[] = []
    const context = contextWith(() => {
      throw new Error("The caller has no active runtime owner")
    })
    expect(() => runtimeFor(context, hostFor(seen), execOf(child))).toThrow(
      "The caller has no active runtime owner",
    )
    expect(seen).toEqual([])
  })

  it("needs a live agent", () => {
    const exec = { signal: new AbortController().signal } as ToolRunContext
    expect(() =>
      runtimeFor(
        contextWith((caller) => caller),
        hostFor([]),
        exec,
      ),
    ).toThrow("This tool needs a live agent session")
  })
})
