import { refKey } from "./config"
import type {
  ModelCatalogModel,
  ModelProviderGroup,
  ModelReasoning,
  ModelRef,
  ModelSelection,
} from "./types"

/** The DeepSeek account route. Listed first and shown under a localized name. */
export const ACCOUNT_PROVIDER = "deepseek-account"
/** The DeepSeek API-key route. Listed second. */
export const OFFICIAL_PROVIDER = "deepseek-official"
/** Recent models shown above the catalog. */
export const RECENT_VISIBLE = 5
/** Recent models kept in storage, so hidden favorites and missing models leave enough to show. */
export const RECENT_STORED = 20

export interface ProviderInfo {
  id: string
  name: string
}

/** One selectable catalog model. */
export interface ModelEntry {
  /** `refKey(provider.id, model.id)`. */
  key: string
  provider: ProviderInfo
  model: ModelCatalogModel
  /** Position in display order: provider order, then catalog order. */
  order: number
}

export type SectionKind = "favorites" | "recent" | "provider" | "results"

export interface PickerSection {
  /** Stable within one catalog: the kind, or `provider:<id>`. */
  id: string
  kind: SectionKind
  /** Heading text; undefined for search results, which have none. */
  label: string | undefined
  entries: ModelEntry[]
}

/** Put the account and official providers first, preserving every other relative order. */
export function orderProviders<T extends { readonly id: string }>(groups: readonly T[]): T[] {
  const rank = (id: string) => (id === ACCOUNT_PROVIDER ? 0 : id === OFFICIAL_PROVIDER ? 1 : 2)
  return [...groups].sort((left, right) => rank(left.id) - rank(right.id))
}

/** The display name of a provider; the account route uses a localized name. */
export function providerName(group: { id: string; name: string }, accountName: string): string {
  return group.id === ACCOUNT_PROVIDER ? accountName : group.name
}

/** Flatten provider groups into entries in display order. */
export function catalogEntries(
  groups: readonly ModelProviderGroup[],
  accountName: string,
): ModelEntry[] {
  const entries: ModelEntry[] = []
  for (const group of orderProviders(groups)) {
    const provider = { id: group.id, name: providerName(group, accountName) }
    for (const model of group.models) {
      entries.push({ key: refKey(group.id, model.id), provider, model, order: entries.length })
    }
  }
  return entries
}

/** Lower-cased, whitespace-separated query terms. */
export function tokenize(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/u)
    .filter((token) => token.length > 0)
}

/** Match quality, best first: exact, prefix, word start, substring. */
export type MatchTier = 0 | 1 | 2 | 3

const WORD_CHAR = /[\p{L}\p{N}]/u

function normalizeField(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ")
}

/** How one term matches one field, or undefined when it does not occur. */
function termTier(field: string, term: string): 1 | 2 | 3 | undefined {
  if (field.startsWith(term)) return 1
  let index = field.indexOf(term)
  if (index < 0) return undefined
  while (index > 0) {
    if (!WORD_CHAR.test(field[index - 1] ?? "")) return 2
    index = field.indexOf(term, index + 1)
  }
  return 3
}

/**
 * Rank one entry against query terms. Every term must occur in the provider
 * name, the model name, or the model id; the weakest term decides the tier.
 * An exact match compares the whole query with the model name or id.
 * @returns the tier, or undefined when a term matches nothing.
 */
export function matchTier(entry: ModelEntry, terms: readonly string[]): MatchTier | undefined {
  if (terms.length === 0) return undefined
  const name = normalizeField(entry.model.name)
  const id = normalizeField(entry.model.id)
  const fields = [name, id, normalizeField(entry.provider.name), normalizeField(entry.provider.id)]
  const whole = terms.join(" ")
  if (whole === name || whole === id) return 0
  let worst: MatchTier = 1
  for (const term of terms) {
    let best: 1 | 2 | 3 | undefined
    for (const field of fields) {
      const tier = termTier(field, term)
      if (tier !== undefined && (best === undefined || tier < best)) best = tier
      if (best === 1) break
    }
    if (best === undefined) return undefined
    if (best > worst) worst = best
  }
  return worst
}

const LAST = Number.MAX_SAFE_INTEGER

/**
 * Search the catalog. Results sort by tier, then favorites, then recency,
 * then display order.
 */
export function searchEntries(
  entries: readonly ModelEntry[],
  query: string,
  favorites: readonly ModelRef[],
  recent: readonly ModelRef[],
): ModelEntry[] {
  const terms = tokenize(query)
  if (terms.length === 0) return []
  const favorite = new Set(favorites.map((ref) => refKey(ref.provider, ref.model)))
  const recency = new Map<string, number>()
  recent.forEach((ref, index) => {
    const key = refKey(ref.provider, ref.model)
    if (!recency.has(key)) recency.set(key, index)
  })
  const scored: { entry: ModelEntry; tier: MatchTier }[] = []
  for (const entry of entries) {
    const tier = matchTier(entry, terms)
    if (tier !== undefined) scored.push({ entry, tier })
  }
  scored.sort(
    (left, right) =>
      left.tier - right.tier ||
      (favorite.has(left.entry.key) ? 0 : 1) - (favorite.has(right.entry.key) ? 0 : 1) ||
      (recency.get(left.entry.key) ?? LAST) - (recency.get(right.entry.key) ?? LAST) ||
      left.entry.order - right.entry.order,
  )
  return scored.map((item) => item.entry)
}

export interface SectionLabels {
  favorites: string
  recent: string
}

/**
 * Lay out the picker. A query yields one ranked results section. An empty
 * query yields Favorites (display order), Recent (most recent first, without
 * favorites), then every provider. Models missing from the catalog are
 * skipped, never removed from the stored lists.
 */
export function buildSections(input: {
  entries: readonly ModelEntry[]
  favorites: readonly ModelRef[]
  recent: readonly ModelRef[]
  query: string
  labels: SectionLabels
}): PickerSection[] {
  const { entries, favorites, recent, query, labels } = input
  if (tokenize(query).length > 0) {
    const results = searchEntries(entries, query, favorites, recent)
    return results.length === 0
      ? []
      : [{ id: "results", kind: "results", label: undefined, entries: results }]
  }
  const sections: PickerSection[] = []
  const favorite = new Set(favorites.map((ref) => refKey(ref.provider, ref.model)))
  const favoriteEntries = entries.filter((entry) => favorite.has(entry.key))
  if (favoriteEntries.length > 0) {
    sections.push({
      id: "favorites",
      kind: "favorites",
      label: labels.favorites,
      entries: favoriteEntries,
    })
  }
  const byKey = new Map(entries.map((entry) => [entry.key, entry]))
  const recentEntries: ModelEntry[] = []
  const seen = new Set<string>()
  for (const ref of recent) {
    if (recentEntries.length >= RECENT_VISIBLE) break
    const key = refKey(ref.provider, ref.model)
    const entry = byKey.get(key)
    if (entry === undefined || favorite.has(key) || seen.has(key)) continue
    seen.add(key)
    recentEntries.push(entry)
  }
  if (recentEntries.length > 0) {
    sections.push({ id: "recent", kind: "recent", label: labels.recent, entries: recentEntries })
  }
  for (const entry of entries) {
    const last = sections[sections.length - 1]
    if (last?.kind === "provider" && last.id === `provider:${entry.provider.id}`) {
      last.entries.push(entry)
    } else {
      sections.push({
        id: `provider:${entry.provider.id}`,
        kind: "provider",
        label: entry.provider.name,
        entries: [entry],
      })
    }
  }
  return sections
}

/** Whether an entry is the given selection's model. */
export function isSelected(entry: ModelEntry, selection: ModelRef | null | undefined): boolean {
  return (
    selection !== null &&
    selection !== undefined &&
    entry.provider.id === selection.provider &&
    entry.model.id === selection.model
  )
}

/** The effort a selection runs with: its own, else the model's default. */
export function effectiveEffort(
  selection: ModelSelection | null,
  reasoning: ModelReasoning | undefined,
): string | undefined {
  return selection?.reasoningEffort ?? reasoning?.defaultEffort
}

/**
 * The effort to send when switching to another model: the current one when
 * the target advertises the same level, otherwise none (the target's default).
 */
export function carriedEffort(
  effort: string | undefined,
  target: ModelReasoning | undefined,
): string | undefined {
  if (effort === undefined || target === undefined) return undefined
  return target.efforts.some((level) => level.id === effort) ? effort : undefined
}

/**
 * The effort to send when switching to another model: the level remembered
 * for that model when it still offers it, otherwise the current level when
 * the target offers it, otherwise none (the target's default).
 */
export function preferredEffort(
  remembered: string | undefined,
  current: string | undefined,
  target: ModelReasoning | undefined,
): string | undefined {
  return carriedEffort(remembered, target) ?? carriedEffort(current, target)
}

export interface EffortChoice {
  key: string
  /** Undefined selects the provider default. */
  effort: string | undefined
  label: string
}

/** The effort buttons for a model: Default (only without a default level), then each level. */
export function effortChoices(
  reasoning: ModelReasoning | undefined,
  defaultLabel: string,
): EffortChoice[] {
  if (reasoning === undefined) return []
  return [
    ...(reasoning.defaultEffort === undefined
      ? [{ key: "provider-default", effort: undefined, label: defaultLabel }]
      : []),
    ...reasoning.efforts.map((level) => ({
      key: `effort:${level.id}`,
      effort: level.id,
      label: level.name,
    })),
  ]
}

/**
 * The trigger's effort caption: undefined without a displayed model, the
 * retained caption for a model without reasoning metadata, Default without an
 * effective level, otherwise the level's name.
 */
export function effortCaption(input: {
  entry: ModelEntry | undefined
  selection: ModelSelection | null
  retainedEffort: string | undefined
  defaultLabel: string
}): string | undefined {
  const { entry, selection, retainedEffort, defaultLabel } = input
  if (entry === undefined) return undefined
  const reasoning = entry.model.reasoning
  if (reasoning === undefined) return retainedEffort
  const effort = effectiveEffort(selection, reasoning)
  if (effort === undefined) return defaultLabel
  return reasoning.efforts.find((level) => level.id === effort)?.name ?? effort
}

/** Add a pair to the end of the list, or remove it when present. */
export function toggleRef(list: readonly ModelRef[], ref: ModelRef): ModelRef[] {
  const key = refKey(ref.provider, ref.model)
  const kept = list.filter((item) => refKey(item.provider, item.model) !== key)
  return kept.length === list.length
    ? [...list, { provider: ref.provider, model: ref.model }]
    : kept
}

/** Move a pair to the front of the list, capped at `limit`. */
export function pushRecent(
  list: readonly ModelRef[],
  ref: ModelRef,
  limit: number = RECENT_STORED,
): ModelRef[] {
  const key = refKey(ref.provider, ref.model)
  return [
    { provider: ref.provider, model: ref.model },
    ...list.filter((item) => refKey(item.provider, item.model) !== key),
  ].slice(0, limit)
}

/** Step through `count` rows: arrows wrap around, page and edge keys clamp. */
export function stepIndex(current: number, delta: number, count: number, wrap: boolean): number {
  if (count <= 0) return -1
  if (current < 0) return delta >= 0 ? 0 : count - 1
  const next = current + delta
  if (wrap) return ((next % count) + count) % count
  return Math.min(Math.max(next, 0), count - 1)
}
