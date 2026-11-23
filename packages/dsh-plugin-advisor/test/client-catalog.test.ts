import { describe, expect, it } from "vitest"
import { effortChoices, findRoute, routeGroups, routeKey } from "../src/client/catalog"
import type { ModelProviderGroup } from "../src/client/types"

const GROUPS: readonly ModelProviderGroup[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    models: [{ id: "v4", name: "DeepSeek V4" }],
  },
  {
    id: "claude",
    name: "Claude subscription",
    models: [
      {
        id: "opus/5.5",
        name: "Opus 5.5",
        reasoning: {
          efforts: [
            { id: "low", name: "Low" },
            { id: "high", name: "High" },
          ],
          defaultEffort: "high",
        },
      },
    ],
  },
]

describe("routeKey", () => {
  it("keeps provider and model apart even when an id has a slash", () => {
    expect(routeKey("a/b", "c")).not.toBe(routeKey("a", "b/c"))
  })
})

describe("routeGroups", () => {
  it("lists every catalog model under its provider", () => {
    expect(routeGroups(GROUPS, { provider: "", model: "" })).toEqual([
      {
        id: "deepseek",
        name: "DeepSeek",
        routes: [
          {
            key: routeKey("deepseek", "v4"),
            provider: "deepseek",
            model: "v4",
            name: "DeepSeek V4",
            available: true,
          },
        ],
      },
      {
        id: "claude",
        name: "Claude subscription",
        routes: [
          {
            key: routeKey("claude", "opus/5.5"),
            provider: "claude",
            model: "opus/5.5",
            name: "Opus 5.5",
            available: true,
          },
        ],
      },
    ])
  })

  it("keeps a saved route the catalog no longer lists, marked unavailable", () => {
    const groups = routeGroups(GROUPS, { provider: "gone", model: "m1" })
    expect(groups.at(-1)).toEqual({
      id: "gone",
      name: "gone",
      routes: [
        {
          key: routeKey("gone", "m1"),
          provider: "gone",
          model: "m1",
          name: "m1",
          available: false,
        },
      ],
    })
  })

  it("adds nothing for a saved route the catalog lists", () => {
    expect(routeGroups(GROUPS, { provider: "deepseek", model: "v4" })).toHaveLength(2)
  })
})

describe("findRoute", () => {
  it("resolves a key back to its provider and model", () => {
    const groups = routeGroups(GROUPS, { provider: "", model: "" })
    expect(findRoute(groups, routeKey("claude", "opus/5.5"))).toEqual({
      provider: "claude",
      model: "opus/5.5",
    })
    expect(findRoute(groups, routeKey("claude", "missing"))).toBeUndefined()
  })
})

describe("effortChoices", () => {
  it("lists the efforts of the selected model", () => {
    expect(effortChoices(GROUPS, "claude", "opus/5.5").map((effort) => effort.id)).toEqual([
      "low",
      "high",
    ])
  })

  it("is empty for a model without efforts or outside the catalog", () => {
    expect(effortChoices(GROUPS, "deepseek", "v4")).toEqual([])
    expect(effortChoices(GROUPS, "gone", "m1")).toEqual([])
  })
})
