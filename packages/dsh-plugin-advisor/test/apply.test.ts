import type { GenerateOptions } from "@deepseek-ai/dsh-llm"
import type { ToolDefinition, ToolRegistrationOptions } from "@deepseek-ai/dsh-tools"
import { describe, expect, it } from "vitest"
import type { AdvisorConfig, FileAttachmentRef } from "../src/contract"
import { apply, Config, inject, name } from "../src/index"

function liveConfig() {
  const value = { provider: "", model: "" }
  const parsed = Config({})
  const config: AdvisorConfig = {
    ...parsed,
    provider: { get: () => value.provider },
    model: { get: () => value.model },
  }
  return { config, value }
}

function contextOf() {
  const registered: { definition: ToolDefinition; options?: ToolRegistrationOptions }[] = []
  const streamed: GenerateOptions[] = []
  const fileRefs: FileAttachmentRef[] = []
  const ctx = {
    tools: {
      register: (definition: ToolDefinition, options?: ToolRegistrationOptions) => {
        registered.push({ definition, options })
        return () => {}
      },
    },
    llm: {
      stream: (options: GenerateOptions) => {
        streamed.push(options)
        return (async function* () {})()
      },
      fileRequestText: (ref: FileAttachmentRef) => {
        fileRefs.push(ref)
        return "file"
      },
    },
  }
  return { ctx, registered, streamed }
}

describe("advisor plugin entry", () => {
  it("declares its name and the services it needs", () => {
    expect(name).toBe("advisor")
    expect(inject).toEqual(["tools", "llm"])
  })

  it("registers the advisor tool and offers it only while a route is set", async () => {
    const { ctx, registered } = contextOf()
    const { config, value } = liveConfig()
    apply(ctx as never, config)

    expect(registered).toHaveLength(1)
    const [entry] = registered
    expect(entry?.definition.name).toBe("advisor")
    const when = entry?.options?.when
    if (when === undefined) throw new Error("expected a when condition")
    const activation = {
      agent: { id: "a1" },
      modelSelection: {},
      signal: new AbortController().signal,
    }

    expect(await when(activation as never)).toBe(false)
    value.provider = "claude"
    value.model = "opus"
    expect(await when(activation as never)).toBe(true)
  })
})
