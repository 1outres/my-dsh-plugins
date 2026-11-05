import { describe, expect, it } from "vitest"
import { normalizeInputSchema, stripNullableUnions } from "../../src/request/schema"

describe("stripNullableUnions", () => {
  it("collapses a nullable union to its one non-null branch", () => {
    expect(stripNullableUnions({ anyOf: [{ type: "string" }, { type: "null" }] })).toEqual({
      type: "string",
    })
    expect(stripNullableUnions({ oneOf: [{ type: "null" }, { type: "integer" }] })).toEqual({
      type: "integer",
    })
  })

  it("leaves a union without a null branch alone", () => {
    const union = { oneOf: [{ type: "string" }, { type: "integer" }] }
    expect(stripNullableUnions(union)).toEqual(union)
  })

  it("leaves a union with several non-null branches alone", () => {
    const union = { anyOf: [{ type: "string" }, { type: "integer" }, { type: "null" }] }
    expect(stripNullableUnions(union)).toEqual(union)
  })

  it("carries the outer description and default onto the survivor", () => {
    const schema = {
      description: "outer",
      default: 3,
      title: "T",
      anyOf: [{ type: "integer", description: "inner" }, { type: "null" }],
    }
    expect(stripNullableUnions(schema)).toEqual({
      type: "integer",
      description: "inner",
      default: 3,
      title: "T",
    })
  })

  it("does not carry a default beside a $ref", () => {
    const schema = { default: null, anyOf: [{ $ref: "#/$defs/x" }, { type: "null" }] }
    expect(stripNullableUnions(schema)).toEqual({ $ref: "#/$defs/x" })
  })

  it("collapses nested unions and a survivor that is itself a union", () => {
    const schema = {
      type: "object",
      properties: {
        a: { anyOf: [{ anyOf: [{ type: "string" }, { type: "null" }] }, { type: "null" }] },
        b: { type: "array", items: { oneOf: [{ type: "number" }, { type: "null" }] } },
      },
    }
    expect(stripNullableUnions(schema)).toEqual({
      type: "object",
      properties: { a: { type: "string" }, b: { type: "array", items: { type: "number" } } },
    })
  })

  it("does not change its input", () => {
    const schema = { anyOf: [{ type: "string" }, { type: "null" }] }
    stripNullableUnions(schema)
    expect(schema).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] })
  })

  it("returns scalars unchanged", () => {
    expect(stripNullableUnions("x")).toBe("x")
    expect(stripNullableUnions(null)).toBeNull()
  })
})

describe("normalizeInputSchema", () => {
  const schema = {
    type: "object",
    properties: {
      mode: { type: "string" },
      proposal: { anyOf: [{ type: "string" }, { type: "null" }] },
      ref: { oneOf: [{ type: "string" }, { type: "integer" }] },
    },
    required: ["mode"],
    allOf: [{ if: { properties: { mode: { const: "proposal" } } }, required: ["proposal"] }],
  }

  it("drops top-level combinators and null branches, and keeps other unions", () => {
    const normalized = normalizeInputSchema(schema)
    expect(normalized).not.toHaveProperty("allOf")
    expect(normalized.required).toEqual(["mode"])
    expect(normalized.properties).toEqual({
      mode: { type: "string" },
      proposal: { type: "string" },
      ref: { oneOf: [{ type: "string" }, { type: "integer" }] },
    })
  })

  it("turns a combinator-only schema into a usable object", () => {
    expect(normalizeInputSchema({ anyOf: [{ type: "object" }] })).toEqual({
      type: "object",
      properties: {},
    })
  })

  it("adds empty properties to an object schema without them", () => {
    expect(normalizeInputSchema({ type: "object" })).toEqual({ type: "object", properties: {} })
  })

  it("keeps a non-object schema as it is", () => {
    expect(normalizeInputSchema({ type: "string" })).toEqual({ type: "string" })
  })
})
