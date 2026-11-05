import { createHash } from "node:crypto"
import type { ToolSchema } from "@deepseek-ai/dsh-llm"
import { describe, expect, it } from "vitest"
import { FailureCode, NativeFailure } from "../../src/errors"
import { declareTools } from "../../src/request/tools"

const LONG_NAME = `mcp__server__${"x".repeat(51)}`

function aliasOf(name: string): string {
  return `${name.slice(0, 41)}_${createHash("sha256").update(name).digest("hex").slice(0, 8)}`
}

function tool(name: string, extra: Partial<ToolSchema> = {}): ToolSchema {
  return { name, description: "", parameters: { type: "object" }, ...extra }
}

function failureOf(run: () => unknown): NativeFailure {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(NativeFailure)
    return error as NativeFailure
  }
  throw new Error("expected the call to fail")
}

describe("declareTools", () => {
  it.each(["x".repeat(51), LONG_NAME])("gives %s a deterministic 50 character alias", (name) => {
    const alias = aliasOf(name)
    const first = declareTools([tool(name)])
    const second = declareTools([tool(name)])
    expect(first).toEqual(second)
    expect(alias).toHaveLength(50)
    expect(first.wire[0]?.name).toBe(`mcp__dsh__${alias}`)
    expect(first.manifest[0]?.name).toBe(alias)
    expect(first.names.get(name)).toBe(alias)
  })

  it("keeps short names as they are on the wire, in the manifest and in the name map", () => {
    const declared = declareTools([tool("probe"), tool("A_1-z"), tool("x".repeat(50))])
    const empty = { type: "object", properties: {} }
    expect(JSON.stringify(declared.wire)).toBe(
      JSON.stringify(
        ["probe", "A_1-z", "x".repeat(50)].map((name) => ({
          name: `mcp__dsh__${name}`,
          description: "",
          input_schema: empty,
        })),
      ),
    )
    expect(declared.manifest).toEqual(
      ["probe", "A_1-z", "x".repeat(50)].map((name) => ({
        name,
        description: "",
        inputSchema: empty,
      })),
    )
    expect([...declared.names]).toEqual([
      ["probe", "probe"],
      ["A_1-z", "A_1-z"],
      ["x".repeat(50), "x".repeat(50)],
    ])
  })

  it("declares nothing for no tools", () => {
    const declared = declareTools([])
    expect(declared.wire).toEqual([])
    expect(declared.manifest).toEqual([])
    expect(declared.names.size).toBe(0)
  })

  it.each(["x".repeat(65), "has.dot", ""])("rejects the name %j", (name) => {
    const failure = failureOf(() => declareTools([tool(name)]))
    expect(failure.code).toBe(FailureCode.invalidRequest)
    expect(failure.message).toContain("at most 64 characters")
  })

  it("rejects a duplicate name", () => {
    const failure = failureOf(() => declareTools([tool("probe"), tool("probe")]))
    expect(failure.message).toContain("at most 64 characters")
  })

  it.each([
    [LONG_NAME, aliasOf(LONG_NAME)],
    [aliasOf(LONG_NAME), LONG_NAME],
  ])("rejects an alias that collides with a short name (%#)", (first, second) => {
    const failure = failureOf(() => declareTools([tool(first), tool(second)]))
    expect(failure.code).toBe(FailureCode.invalidRequest)
    expect(failure.message).toContain("collision")
    expect(failure.message).toContain(aliasOf(LONG_NAME))
    expect(failure.message).toContain(LONG_NAME)
  })

  it("normalizes the schema the same way for the manifest and the wire", () => {
    const parameters = {
      type: "object",
      properties: {
        mode: { type: "string" },
        proposal: { anyOf: [{ type: "string" }, { type: "null" }] },
        ref: { oneOf: [{ type: "string" }, { type: "integer" }] },
      },
      required: ["mode"],
      allOf: [{ if: { properties: { mode: { const: "proposal" } } }, required: ["proposal"] }],
    }
    const declared = declareTools([tool("probe", { parameters })])
    for (const schema of [declared.wire[0]?.input_schema, declared.manifest[0]?.inputSchema]) {
      expect(schema).not.toHaveProperty("allOf")
      expect(schema).toMatchObject({
        required: ["mode"],
        properties: {
          proposal: { type: "string" },
          ref: { oneOf: [{ type: "string" }, { type: "integer" }] },
        },
      })
    }
  })

  it("includes tools whose loading is deferred", () => {
    const declared = declareTools([tool("late", { deferLoading: true })])
    expect(declared.names.has("late")).toBe(true)
  })
})
