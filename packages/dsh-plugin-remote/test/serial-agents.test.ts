import type { Context } from "@deepseek-ai/cordis"
import type { Agent } from "@deepseek-ai/dsh-agent"
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools"
import { afterEach, describe, expect, it } from "vitest"
import type { HostRuntime, RootRuntime } from "../src/host/runtime"
import { SerialAgents } from "../src/host/serial/agents"
import { registerSerialTools } from "../src/host/tools/serial"
import type { SerialAgentStatus } from "../src/shared/types"
import { type ConnectAgentResult, connectAgent, makeAgent } from "./serial/helpers"

const open: ConnectAgentResult[] = []

afterEach(async () => {
  while (open.length > 0) {
    const rig = open.pop()
    if (rig === undefined) continue
    rig.connection.close(1000, "test done")
    await rig.pair.close()
  }
})

const root = { id: "root" } as Agent

describe("remote_serial_agents", () => {
  it("lists online ports with their lease owners", async () => {
    const agent = makeAgent()
    const agents = new SerialAgents([agent.authorized])
    const rig = await connectAgent(agents, agent)
    open.push(rig)
    agents.lease(agent.name, "/dev/ttyUSB0", { sessionId: "root", targetName: "core-sw" })
    agents.lease(agent.name, "/dev/ttyUSB1", { sessionId: "other", targetName: "other-sw" })
    rig.fake.respond((request) => {
      if (request.method !== "ports.list") return undefined
      return {
        result: {
          ports: [
            {
              path: "/dev/ttyUSB0",
              description: "USB serial",
              usb: { vendorId: "0403", productId: "6001" },
              open: true,
              handle: "p1",
              settings: {
                baudRate: 9600,
                dataBits: 8,
                parity: "none",
                stopBits: 1,
                flowControl: "none",
              },
            },
            { path: "/dev/ttyUSB1", open: true, handle: "p2" },
            { path: "/dev/ttyUSB2", open: false },
          ],
        },
      }
    })
    const definition = serialTool(agents)
    const value = (await definition.execute({}, runContext())) as {
      agents: SerialAgentStatus[]
    }
    const status = value.agents[0]
    expect(status.online).toBe(true)
    expect(status.info?.hostname).toBe("lab-mac")
    expect(status.ports[0]).toEqual({
      path: "/dev/ttyUSB0",
      description: "USB serial",
      usb: { vendorId: "0403", productId: "6001" },
      open: true,
      settings: { baudRate: 9600, dataBits: 8, parity: "none", stopBits: 1, flowControl: "none" },
      usedBy: "core-sw",
      usedElsewhere: false,
    })
    expect(status.ports[1]).toMatchObject({ usedElsewhere: true })
    expect(status.ports[2]).toMatchObject({ open: false, usedElsewhere: false })
    const text = definition.output
      .render({}, value as never)
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n")
    expect(text).toContain("used by core-sw")
    expect(text).toContain("in use by another session")
  })

  it("reports an offline agent without asking it for ports", async () => {
    const agent = makeAgent()
    const definition = serialTool(new SerialAgents([agent.authorized]))
    const value = (await definition.execute({}, runContext())) as {
      agents: SerialAgentStatus[]
    }
    expect(value.agents).toEqual([
      {
        name: agent.name,
        fingerprint: agent.authorized.key.fingerprint,
        online: false,
        ports: [],
      },
    ])
  })
})

function runContext(): ToolRunContext {
  return {
    agent: root,
    callId: "call-1",
    signal: new AbortController().signal,
  } as ToolRunContext
}

function serialTool(agents: SerialAgents): ToolDefinition {
  const registered = new Map<string, ToolDefinition>()
  const ctx = {
    tools: {
      register(definition: ToolDefinition) {
        registered.set(definition.name, definition)
        return () => {}
      },
    },
    agents: { list: () => [root], isOwnedBy: () => false },
    logger: { warn: () => {}, error: () => {} },
  } as unknown as Context
  const runtime = { sessionId: root.id } as unknown as RootRuntime
  const host = {
    config: { maxOutputBytes: 30_000 },
    serial: agents,
    runtimeFor: () => runtime,
  } as unknown as HostRuntime
  registerSerialTools(ctx, host)
  const definition = registered.get("remote_serial_agents")
  if (definition === undefined) throw new Error("remote_serial_agents was not registered")
  return definition
}
