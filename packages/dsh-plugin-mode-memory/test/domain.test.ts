import { describe, expect, it } from "vitest"
import { MODE_MEMORY_DOMAIN, rememberedModeSchema } from "../src/host/domain"

describe("remembered mode schema", () => {
  it("accepts a preset id and an epoch time", () => {
    expect(rememberedModeSchema.parse({ agentPreset: "cordis", updatedAt: 0 })).toEqual({
      agentPreset: "cordis",
      updatedAt: 0,
    })
  })

  it("rejects an empty preset", () => {
    expect(rememberedModeSchema.safeParse({ agentPreset: "", updatedAt: 1 }).success).toBe(false)
  })

  it("rejects a negative or fractional time", () => {
    expect(rememberedModeSchema.safeParse({ agentPreset: "ptc", updatedAt: -1 }).success).toBe(
      false,
    )
    expect(rememberedModeSchema.safeParse({ agentPreset: "ptc", updatedAt: 1.5 }).success).toBe(
      false,
    )
  })

  it("rejects a record with a missing field", () => {
    expect(rememberedModeSchema.safeParse({ agentPreset: "ptc" }).success).toBe(false)
    expect(rememberedModeSchema.safeParse({ updatedAt: 1 }).success).toBe(false)
  })
})

describe("domain spec", () => {
  it("stores one projects table and skips bad records", () => {
    expect(MODE_MEMORY_DOMAIN.name).toBe("mode_memory")
    expect(MODE_MEMORY_DOMAIN.version).toBe(1)
    expect(MODE_MEMORY_DOMAIN.invalidRecords).toBe("backup-and-skip")
    expect(MODE_MEMORY_DOMAIN.tables.projects.valueSchema).toBe(rememberedModeSchema)
  })
})
