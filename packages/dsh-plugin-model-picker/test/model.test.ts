import { describe, expect, it } from "vitest"
import { refKey } from "../src/client/config"
import {
  buildSections,
  carriedEffort,
  catalogEntries,
  effectiveEffort,
  effortCaption,
  effortChoices,
  matchTier,
  orderProviders,
  pushRecent,
  RECENT_VISIBLE,
  searchEntries,
  stepIndex,
  toggleRef,
  tokenize,
} from "../src/client/model"
import type { ModelProviderGroup, ModelReasoning } from "../src/client/types"

const reasoning: ModelReasoning = {
  efforts: [
    { id: "low", name: "Low" },
    { id: "high", name: "High" },
    { id: "xhigh", name: "Extra high" },
  ],
  defaultEffort: "high",
}

const groups: ModelProviderGroup[] = [
  {
    id: "orcarouter",
    name: "OrcaRouter",
    models: [
      { id: "anthropic/claude-opus-4.6", name: "Anthropic: Claude Opus 4.6", reasoning },
      { id: "anthropic/claude-sonnet-4.6", name: "Anthropic: Claude Sonnet 4.6" },
      { id: "orcarouter/fusion", name: "orcarouter/fusion" },
    ],
  },
  {
    id: "deepseek-official",
    name: "DeepSeek",
    models: [{ id: "deepseek-chat", name: "DeepSeek-V4.1-Flash" }],
  },
  {
    id: "claude-subscription",
    name: "Claude subscription",
    models: [{ id: "claude-opus-5-5", name: "Claude Opus 5.5" }],
  },
  {
    id: "deepseek-account",
    name: "deepseek-account",
    models: [{ id: "deepseek-chat", name: "DeepSeek-V4.1-Flash" }],
  },
]

const entries = catalogEntries(groups, "DeepSeek Account")
const names = (list: { model: { name: string }; provider: { id: string } }[]) =>
  list.map((entry) => `${entry.provider.id}:${entry.model.name}`)

describe("provider order", () => {
  it("puts the account and official DeepSeek routes first and keeps the rest", () => {
    expect(orderProviders(groups).map((group) => group.id)).toEqual([
      "deepseek-account",
      "deepseek-official",
      "orcarouter",
      "claude-subscription",
    ])
  })

  it("renames the account route and numbers entries in display order", () => {
    expect(entries[0]?.provider.name).toBe("DeepSeek Account")
    expect(entries.map((entry) => entry.order)).toEqual([0, 1, 2, 3, 4, 5])
    expect(entries[2]?.key).toBe(refKey("orcarouter", "anthropic/claude-opus-4.6"))
  })
})

describe("search", () => {
  it("splits the query into lower-cased terms", () => {
    expect(tokenize("  Opus   4.6 ")).toEqual(["opus", "4.6"])
    expect(tokenize("   ")).toEqual([])
  })

  it("requires every term and ranks exact, prefix, word start, then substring", () => {
    const opus = entries.find((entry) => entry.model.id === "anthropic/claude-opus-4.6")
    if (opus === undefined) throw new Error("fixture")
    expect(matchTier(opus, tokenize("Anthropic: Claude Opus 4.6"))).toBe(0)
    expect(matchTier(opus, tokenize("anthropic/claude-opus-4.6"))).toBe(0)
    expect(matchTier(opus, tokenize("anthro"))).toBe(1)
    expect(matchTier(opus, tokenize("opus 4.6"))).toBe(2)
    expect(matchTier(opus, tokenize("pus"))).toBe(3)
    expect(matchTier(opus, tokenize("opus sonnet"))).toBeUndefined()
  })

  it("matches the provider name as well as the model", () => {
    const results = searchEntries(entries, "orca fusion", [], [])
    expect(names(results)).toEqual(["orcarouter:orcarouter/fusion"])
    expect(names(searchEntries(entries, "subscription", [], []))).toEqual([
      "claude-subscription:Claude Opus 5.5",
    ])
  })

  it("breaks ties by favorites, then recent use, then display order", () => {
    const plain = searchEntries(entries, "claude", [], [])
    expect(names(plain)).toEqual([
      "claude-subscription:Claude Opus 5.5",
      "orcarouter:Anthropic: Claude Opus 4.6",
      "orcarouter:Anthropic: Claude Sonnet 4.6",
    ])
    const ranked = searchEntries(
      entries,
      "claude",
      [{ provider: "orcarouter", model: "anthropic/claude-sonnet-4.6" }],
      [{ provider: "orcarouter", model: "anthropic/claude-opus-4.6" }],
    )
    expect(names(ranked)).toEqual([
      "claude-subscription:Claude Opus 5.5",
      "orcarouter:Anthropic: Claude Sonnet 4.6",
      "orcarouter:Anthropic: Claude Opus 4.6",
    ])
  })
})

describe("sections", () => {
  const labels = { favorites: "Favorites", recent: "Recent" }

  it("lays out favorites, recent, then every provider for an empty query", () => {
    const sections = buildSections({
      entries,
      favorites: [
        { provider: "claude-subscription", model: "claude-opus-5-5" },
        { provider: "orcarouter", model: "anthropic/claude-sonnet-4.6" },
        { provider: "gone", model: "missing" },
      ],
      recent: [
        { provider: "orcarouter", model: "anthropic/claude-sonnet-4.6" },
        { provider: "gone", model: "missing" },
        { provider: "deepseek-official", model: "deepseek-chat" },
      ],
      query: "",
      labels,
    })
    expect(sections.map((section) => section.id)).toEqual([
      "favorites",
      "recent",
      "provider:deepseek-account",
      "provider:deepseek-official",
      "provider:orcarouter",
      "provider:claude-subscription",
    ])
    expect(names(sections[0]?.entries ?? [])).toEqual([
      "orcarouter:Anthropic: Claude Sonnet 4.6",
      "claude-subscription:Claude Opus 5.5",
    ])
    expect(names(sections[1]?.entries ?? [])).toEqual(["deepseek-official:DeepSeek-V4.1-Flash"])
    expect(sections[4]?.entries).toHaveLength(3)
    expect(sections[0]?.label).toBe("Favorites")
    expect(sections[2]?.label).toBe("DeepSeek Account")
  })

  it("caps the recent section", () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      id: `m${index}`,
      name: `Model ${index}`,
    }))
    const wide = catalogEntries([{ id: "p", name: "P", models: many }], "")
    const sections = buildSections({
      entries: wide,
      favorites: [],
      recent: many.map((model) => ({ provider: "p", model: model.id })),
      query: "",
      labels,
    })
    expect(sections[0]?.kind).toBe("recent")
    expect(sections[0]?.entries).toHaveLength(RECENT_VISIBLE)
  })

  it("returns one unlabeled results section for a query, or none", () => {
    const sections = buildSections({ entries, favorites: [], recent: [], query: "opus", labels })
    expect(sections).toHaveLength(1)
    expect(sections[0]?.kind).toBe("results")
    expect(sections[0]?.label).toBeUndefined()
    expect(buildSections({ entries, favorites: [], recent: [], query: "zzz", labels })).toEqual([])
  })
})

describe("effort", () => {
  it("uses the selection's effort, else the model default", () => {
    expect(effectiveEffort({ provider: "a", model: "b", reasoningEffort: "low" }, reasoning)).toBe(
      "low",
    )
    expect(effectiveEffort({ provider: "a", model: "b" }, reasoning)).toBe("high")
    expect(effectiveEffort(null, undefined)).toBeUndefined()
  })

  it("carries an effort only to a model that offers it", () => {
    expect(carriedEffort("xhigh", reasoning)).toBe("xhigh")
    expect(carriedEffort("max", reasoning)).toBeUndefined()
    expect(carriedEffort("high", undefined)).toBeUndefined()
    expect(carriedEffort(undefined, reasoning)).toBeUndefined()
  })

  it("offers Default only when the model has no default level", () => {
    expect(effortChoices(reasoning, "Default").map((choice) => choice.label)).toEqual([
      "Low",
      "High",
      "Extra high",
    ])
    const open = effortChoices({ efforts: [{ id: "low", name: "Low" }] }, "Default")
    expect(open.map((choice) => choice.effort)).toEqual([undefined, "low"])
    expect(effortChoices(undefined, "Default")).toEqual([])
  })

  it("captions the trigger like the shipped selector", () => {
    const opus = entries.find((entry) => entry.model.reasoning !== undefined)
    const sonnet = entries.find((entry) => entry.model.id === "anthropic/claude-sonnet-4.6")
    const base = { retainedEffort: "Saved", defaultLabel: "Default" }
    expect(effortCaption({ ...base, entry: undefined, selection: null })).toBeUndefined()
    expect(effortCaption({ ...base, entry: sonnet, selection: null })).toBe("Saved")
    expect(
      effortCaption({
        ...base,
        entry: opus,
        selection: { provider: "orcarouter", model: "x", reasoningEffort: "xhigh" },
      }),
    ).toBe("Extra high")
    const noDefault = { ...entries[0], model: { id: "x", name: "X", reasoning: { efforts: [] } } }
    expect(
      effortCaption({
        ...base,
        entry: noDefault as never,
        selection: { provider: "p", model: "x" },
      }),
    ).toBe("Default")
  })
})

describe("lists", () => {
  it("toggles a favorite at the end of the list", () => {
    const one = toggleRef([], { provider: "a", model: "x/y" })
    expect(one).toEqual([{ provider: "a", model: "x/y" }])
    const two = toggleRef(one, { provider: "b", model: "z" })
    expect(two.map((ref) => ref.provider)).toEqual(["a", "b"])
    expect(toggleRef(two, { provider: "a", model: "x/y" })).toEqual([{ provider: "b", model: "z" }])
  })

  it("moves a recent model to the front and caps the list", () => {
    const list = pushRecent(
      [
        { provider: "a", model: "1" },
        { provider: "a", model: "2" },
      ],
      { provider: "a", model: "2" },
    )
    expect(list.map((ref) => ref.model)).toEqual(["2", "1"])
    expect(pushRecent(list, { provider: "a", model: "3" }, 2).map((ref) => ref.model)).toEqual([
      "3",
      "2",
    ])
  })

  it("wraps arrow steps and clamps page steps", () => {
    expect(stepIndex(4, 1, 5, true)).toBe(0)
    expect(stepIndex(0, -1, 5, true)).toBe(4)
    expect(stepIndex(3, 7, 5, false)).toBe(4)
    expect(stepIndex(1, -7, 5, false)).toBe(0)
    expect(stepIndex(-1, -1, 5, true)).toBe(4)
    expect(stepIndex(0, 1, 0, true)).toBe(-1)
  })
})
