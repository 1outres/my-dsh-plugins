import { CONTEXT_WINDOWS, nativeModel, PICKER_ROUTES } from "../catalog"
import type { DiscoveredModel, JsonObject } from "../contract"

const LONG_CONTEXT_SUFFIX = "[1m]"
const USAGE_CREDITS = "usage credits"
const UNPINNED = "unpinned"
const SEPARATOR = " · "

// Fable 5 and 5.1 are part of Max and Ultra and of premium Team and Enterprise seats. Pro and
// standard seats bill both to usage credits from the first request, and under `-p` the CLI bills
// without asking. The CLI says so only at request time, so the documented rule is applied here:
// https://support.claude.com/en/articles/15424964
const CREDIT_BILLED_MODELS: ReadonlySet<string> = new Set(["claude-fable-5", "claude-fable-5-1"])

interface BillingRule {
  models: ReadonlySet<string>
  note: string
}

interface PickerEntry {
  id: string
  name: string
  note: string
  /** The name came from the CLI's `default` row, which is an alias and may not name the model. */
  namedByDefaultRow: boolean
}

function billingRuleOf(plan: string): BillingRule {
  const lower = plan.toLowerCase()
  if (lower.includes("pro")) return { models: CREDIT_BILLED_MODELS, note: USAGE_CREDITS }
  if (lower.includes("team") || lower.includes("enterprise")) {
    // The handshake names the plan, not the seat tier, so the note states the rule.
    return { models: CREDIT_BILLED_MODELS, note: `${USAGE_CREDITS} on standard seats` }
  }
  return { models: new Set(), note: USAGE_CREDITS }
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function withoutLongContext(model: string): string {
  return model.endsWith(LONG_CONTEXT_SUFFIX) ? model.slice(0, -LONG_CONTEXT_SUFFIX.length) : model
}

function isPinned(route: string): boolean {
  return Object.hasOwn(CONTEXT_WINDOWS, withoutLongContext(route))
}

function announcedModel(row: JsonObject): string {
  return textOf(row.resolvedModel) || textOf(row.value)
}

// The served catalog names the model in displayName ("Opus 5.5"). The generic list names only the
// family there ("Opus") and the model before the "·" of its description. The version comes before
// any "(...)", because the "1" of "(1M context)" is no version.
function nameOf(row: JsonObject, route: string): string {
  const display = textOf(row.displayName).trim()
  const beforeParenthesis = display.split("(")[0] ?? ""
  const namesVersion = /\d/.test(beforeParenthesis) && !display.toLowerCase().startsWith("default")
  if (namesVersion) return display
  return textOf(row.description).split("·")[0]?.trim() || route
}

/** `claude-opus-4-8` becomes `Opus 4.8`. A trailing snapshot date is dropped. */
function catalogName(canonical: string): string {
  const [family = "", ...rest] = canonical.replace(/^claude-/, "").split("-")
  const version = rest.filter((part) => /^\d{1,7}$/.test(part)).join(".")
  const title = `${family.charAt(0).toUpperCase()}${family.slice(1)}`
  return version === "" ? title : `${title} ${version}`
}

function routeOf(row: JsonObject, base: string, longContext: ReadonlySet<string>): string | null {
  const route = nativeModel(base)
  if (isPinned(route)) return route
  // A `value` the CLI did not resolve, such as `default` or `best`, is an alias and not a model.
  if (textOf(row.resolvedModel) === "") return null
  return longContext.has(base) ? `${base}${LONG_CONTEXT_SUFFIX}` : route
}

function isDefaultRow(row: JsonObject): boolean {
  return textOf(row.value) === "default"
}

function newEntry(row: JsonObject, route: string): PickerEntry {
  return {
    id: route,
    name: nameOf(row, route),
    note: isPinned(route) ? "" : UNPINNED,
    namedByDefaultRow: isDefaultRow(row),
  }
}

function applyRowName(entry: PickerEntry, row: JsonObject): void {
  if (!entry.namedByDefaultRow || isDefaultRow(row)) return
  entry.name = nameOf(row, entry.id)
  entry.namedByDefaultRow = false
}

// The CLI's own wording is about this account, so it beats the seat-tier note. A billing warning
// reads first, and an unpinned row keeps its marker after it.
function applyBillingNote(
  entry: PickerEntry,
  row: JsonObject,
  base: string,
  rule: BillingRule,
): void {
  const described = textOf(row.description).toLowerCase().includes("usage credit")
  if (!described && !rule.models.has(base)) return
  const warning = described ? USAGE_CREDITS : rule.note
  entry.note = isPinned(entry.id) ? warning : `${warning}${SEPARATOR}${UNPINNED}`
}

function advertisedEntries(
  rows: readonly JsonObject[],
  rule: BillingRule,
): Map<string, PickerEntry> {
  const announced = rows.map(announcedModel)
  const longContext = new Set(
    announced.filter((model) => model.endsWith(LONG_CONTEXT_SUFFIX)).map(withoutLongContext),
  )
  const entries = new Map<string, PickerEntry>()
  for (const row of rows) {
    const base = withoutLongContext(announcedModel(row))
    if (base === "") continue
    const route = routeOf(row, base, longContext)
    if (route === null) continue
    const entry = entries.get(route) ?? newEntry(row, route)
    entries.set(route, entry)
    applyRowName(entry, row)
    applyBillingNote(entry, row, base, rule)
  }
  return entries
}

function appendPinnedRoutes(entries: Map<string, PickerEntry>, rule: BillingRule): void {
  for (const route of PICKER_ROUTES) {
    if (entries.has(route)) continue
    const canonical = withoutLongContext(route)
    entries.set(route, {
      id: route,
      name: catalogName(canonical),
      note: rule.models.has(canonical) ? rule.note : "",
      namedByDefaultRow: false,
    })
  }
}

function toDiscovered({ id, name, note }: PickerEntry): DiscoveredModel {
  return note === "" ? { id, name } : { id, name, description: note }
}

/**
 * Merges the account's live picker with the pinned catalog.
 *
 * The pinned table adds metadata to the models it knows but never decides visibility, so a model
 * the CLI ships first is listed the same day. The live picker names only each family's current
 * model, yet the account still runs the older pinned ones, so every pinned route that it omits
 * follows the advertised rows. Access-gated routes are never appended.
 *
 * Returns no rows when the picker advertises no model. Callers treat that as a failed answer.
 */
export function mergePicker(rows: readonly JsonObject[], plan: string): DiscoveredModel[] {
  const rule = billingRuleOf(plan)
  const entries = advertisedEntries(rows, rule)
  if (entries.size === 0) return []
  appendPinnedRoutes(entries, rule)
  return [...entries.values()].map(toDiscovered)
}
