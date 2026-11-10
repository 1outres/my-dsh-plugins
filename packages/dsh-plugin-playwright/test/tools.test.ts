import type { Context } from "@deepseek-ai/cordis"
import type { Agent } from "@deepseek-ai/dsh-agent"
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools"
import { describe, expect, test } from "vitest"
import type { UpstreamTool } from "../src/host/catalog"
import { registerPlaywrightTools } from "../src/host/tools"

function tool(name: string, options: { readOnly?: boolean } = {}): UpstreamTool {
  return {
    name,
    title: `${name} title`,
    description: `${name} description`,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    readOnly: options.readOnly === true,
    taskRequired: false,
  }
}

interface Services {
  attachments?: unknown
  llm?: unknown
}

function makeContext(
  agents: { list: () => Agent[]; isOwnedBy: (id: string, parent: Agent) => boolean },
  services: Services = {},
) {
  const registered: ToolDefinition[] = []
  const ctx = {
    get: (name: string) => services[name as keyof Services],
    logger: { warn: () => {}, error: () => {} },
    tools: {
      register(definition: ToolDefinition) {
        registered.push(definition)
        return () => {}
      },
    },
    agents,
  } as unknown as Context
  return { ctx, registered }
}

function runContext(agent: Agent): ToolRunContext {
  return { agent, signal: new AbortController().signal } as ToolRunContext
}

function textOf(blocks: Array<{ type: string; text?: string }>): string {
  return blocks
    .flatMap((block) => (block.type === "text" && block.text !== undefined ? [block.text] : []))
    .join("\n")
}

const noOwners = { list: () => [] as Agent[], isOwnedBy: () => false }

describe("registerPlaywrightTools", () => {
  test("forwards a call through the root session and returns text", async () => {
    const root = { id: "root" } as Agent
    const { ctx, registered } = makeContext(noOwners)
    const names: string[] = []
    const registry = {
      async acquire(agent: Agent) {
        expect(agent).toBe(root)
        return {
          async call(name: string, args: Record<string, unknown>) {
            names.push(name)
            expect(args).toEqual({ url: "https://example.com" })
            return { content: [{ type: "text", text: "Navigated to https://example.com" }] }
          },
        }
      },
    }
    registerPlaywrightTools(ctx, registry, [tool("browser_navigate")], 30000)
    const definition = registered[0]
    if (definition === undefined) throw new Error("tool was not registered")
    const args = { url: "https://example.com" }
    const exec = runContext(root)
    const value = await definition.execute(args, exec)
    expect(names).toEqual(["browser_navigate"])
    expect(textOf(definition.output.render(args, value as never))).toBe(
      "Navigated to https://example.com",
    )
  })

  test("resolves a sub-agent to the root session", async () => {
    const root = { id: "root" } as Agent
    const child = { id: "child" } as Agent
    const agents = {
      list: () => [root, child],
      isOwnedBy: (id: string, parent: Agent) => id === "child" && parent.id === "root",
    }
    const { ctx, registered } = makeContext(agents)
    const acquired: string[] = []
    const registry = {
      async acquire(agent: Agent) {
        acquired.push(agent.id)
        return {
          async call() {
            return { content: [{ type: "text", text: "ok" }] }
          },
        }
      },
    }
    registerPlaywrightTools(ctx, registry, [tool("browser_snapshot")], 30000)
    const definition = registered[0]
    if (definition === undefined) throw new Error("tool was not registered")
    await definition.execute({}, runContext(child))
    expect(acquired).toEqual(["root"])
  })

  test("caps the model-facing text", async () => {
    const root = { id: "root" } as Agent
    const { ctx, registered } = makeContext(noOwners)
    const registry = {
      async acquire() {
        return {
          async call() {
            return { content: [{ type: "text", text: "a".repeat(5000) }] }
          },
        }
      },
    }
    registerPlaywrightTools(ctx, registry, [tool("browser_snapshot")], 1024)
    const definition = registered[0]
    if (definition === undefined) throw new Error("tool was not registered")
    const value = await definition.execute({}, runContext(root))
    const text = textOf(definition.output.render({}, value as never))
    expect(text).toBe(`${"a".repeat(1024)}\n[output truncated]`)
  })

  test("does not split a multi-byte character when capping", async () => {
    const root = { id: "root" } as Agent
    const { ctx, registered } = makeContext(noOwners)
    const registry = {
      async acquire() {
        return {
          async call() {
            return { content: [{ type: "text", text: "あ".repeat(2000) }] }
          },
        }
      },
    }
    registerPlaywrightTools(ctx, registry, [tool("browser_snapshot")], 1024)
    const definition = registered[0]
    if (definition === undefined) throw new Error("tool was not registered")
    const value = await definition.execute({}, runContext(root))
    const text = textOf(definition.output.render({}, value as never))
    expect(text).not.toContain("\uFFFD")
    const body = text.slice(0, -"\n[output truncated]".length)
    expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(1024)
    expect(text).toBe(`${"あ".repeat(Math.floor(1024 / 3))}\n[output truncated]`)
  })

  test("turns an MCP error result into a failed call", async () => {
    const root = { id: "root" } as Agent
    const { ctx, registered } = makeContext(noOwners)
    const registry = {
      async acquire() {
        return {
          async call() {
            return { isError: true, content: [{ type: "text", text: "Element was not found" }] }
          },
        }
      },
    }
    registerPlaywrightTools(ctx, registry, [tool("browser_click")], 30000)
    const definition = registered[0]
    if (definition === undefined) throw new Error("tool was not registered")
    await expect(definition.execute({ target: "e1" }, runContext(root))).rejects.toThrow(
      "Element was not found",
    )
  })

  test("saves an image result as a durable attachment", async () => {
    const root = {
      id: "root",
      options: { provider: "test-provider", model: "test-model" },
      session: { requestHeader: () => undefined },
    } as unknown as Agent
    const saved: Array<{ data: Buffer; mediaType: string }> = []
    const { ctx, registered } = makeContext(noOwners, {
      attachments: {
        async saveImages(images: Array<{ data: Buffer; mediaType: string }>) {
          saved.push(...images)
          return [{ id: "attachment-1" }]
        },
      },
      llm: {
        async resolveModelInfo() {
          return { inputModalities: ["image"] }
        },
      },
    })
    const image = Buffer.from("not really a png").toString("base64")
    const registry = {
      async acquire() {
        return {
          async call() {
            return { content: [{ type: "image", data: image, mimeType: "image/png" }] }
          },
        }
      },
    }
    registerPlaywrightTools(ctx, registry, [tool("browser_take_screenshot")], 30000)
    const definition = registered[0]
    if (definition === undefined) throw new Error("tool was not registered")
    const args = { scale: "css" }
    const exec = runContext(root)
    const value = await definition.execute(args, exec)
    const content = definition.projectContent?.(exec, {
      isError: false,
      value: value as never,
      content: definition.output.render(args, value as never),
    })
    expect(saved).toHaveLength(1)
    expect(saved[0]?.mediaType).toBe("image/png")
    expect(content).toEqual([{ type: "image", attachment: { id: "attachment-1" } }])
  })

  test("gives every tool a readable card title", () => {
    const { ctx, registered } = makeContext(noOwners)
    const registry = {
      async acquire() {
        return {
          async call() {
            return { content: [] }
          },
        }
      },
    }
    registerPlaywrightTools(ctx, registry, [tool("browser_snapshot", { readOnly: true })], 30000)
    const definition = registered[0]
    expect(definition?.presentCall?.({})).toEqual({
      card: "generic",
      title: "browser_snapshot title",
      kind: "read",
    })
  })
})
