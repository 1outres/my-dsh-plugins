import { FailureCode, NativeFailure } from "./errors"

const LONG_CONTEXT_SUFFIX = "[1m]"
const LONG_CONTEXT_WINDOW = 1_000_000
const DEFAULT_WINDOW = 200_000

/** Pinned native routes. A loopback gateway needs an explicit long-context selection. */
export const CONTEXT_WINDOWS: Readonly<Record<string, number>> = {
  "claude-sonnet-5-5": LONG_CONTEXT_WINDOW,
  "claude-sonnet-5": LONG_CONTEXT_WINDOW,
  "claude-haiku-5-5": LONG_CONTEXT_WINDOW,
  "claude-haiku-4-5-20251001": DEFAULT_WINDOW,
  "claude-opus-5-5": LONG_CONTEXT_WINDOW,
  "claude-opus-5": LONG_CONTEXT_WINDOW,
  "claude-opus-4-8": LONG_CONTEXT_WINDOW,
  "claude-fable-5-1": LONG_CONTEXT_WINDOW,
  "claude-mythos-5-1": LONG_CONTEXT_WINDOW,
}

/**
 * Models Anthropic grants per organization. They are pinned like any route, but the picker
 * lists one only when the account's own picker offers it.
 */
export const ACCESS_GATED: ReadonlySet<string> = new Set(["claude-mythos-5-1"])

export const ALIASES: Readonly<Record<string, string>> = {
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-5-5",
  "claude-haiku-4-5": "claude-haiku-4-5-20251001",
  opus: "claude-opus-5-5",
  fable: "claude-fable-5-1",
}

// These families answer `thinking: {type: "disabled"}` with a 400. Opus 5.5 and Sonnet 5.5 are
// listed by their full id because plain Opus 5 and Sonnet 5 still accept the disable.
const MANDATORY_THINKING_PREFIXES = [
  "claude-fable",
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-haiku-5-5",
  "claude-mythos",
]

// Haiku 4.5 answers `thinking: {type: "adaptive"}` with a 400. Unknown routes keep adaptive
// thinking so a future model is not downgraded by mistake.
const NO_ADAPTIVE_THINKING: ReadonlySet<string> = new Set(["claude-haiku-4-5-20251001"])

function lookup<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined
}

function isCatalogued(name: string): boolean {
  return lookup(ALIASES, name) !== undefined || lookup(CONTEXT_WINDOWS, name) !== undefined
}

/**
 * The catalogued name a short spelling points at, such as `sonnet-5.5` for `claude-sonnet-5-5`.
 * A name that matches nothing is returned as typed, so an unknown route reaches the CLI and
 * fails there.
 */
function routeBase(name: string): string {
  if (isCatalogued(name)) return name
  const dotted = name.replaceAll(".", "-")
  if (dotted !== name) return routeBase(dotted)
  const vendored = `claude-${name.startsWith("claude-") ? name.slice("claude-".length) : name}`
  return isCatalogued(vendored) ? vendored : name
}

interface Route {
  canonical: string
  longContextRequested: boolean
}

function resolveRoute(model: string): Route {
  const longContextRequested = model.endsWith(LONG_CONTEXT_SUFFIX)
  const bare = longContextRequested ? model.slice(0, -LONG_CONTEXT_SUFFIX.length) : model
  const base = routeBase(bare)
  return { canonical: lookup(ALIASES, base) ?? base, longContextRequested }
}

/** The value for `--model`. `[1m]` is added only for ids pinned at a 1M window. */
export function nativeModel(model: string): string {
  const { canonical, longContextRequested } = resolveRoute(model)
  const window = lookup(CONTEXT_WINDOWS, canonical)
  if (window === LONG_CONTEXT_WINDOW) return `${canonical}${LONG_CONTEXT_SUFFIX}`
  if (window === undefined) return model
  if (longContextRequested) {
    throw new NativeFailure(
      "Haiku 4.5 does not support a 1M context window",
      FailureCode.invalidRequest,
    )
  }
  return canonical
}

/**
 * The window of a route. A pinned id reports its pinned window. An unpinned plain id runs
 * natively inside the 200K default. An unpinned `[1m]` id promises nothing, so it reports none.
 */
export function contextWindowOf(model: string): number | undefined {
  const { canonical, longContextRequested } = resolveRoute(model)
  const pinned = lookup(CONTEXT_WINDOWS, canonical)
  if (longContextRequested) return pinned === LONG_CONTEXT_WINDOW ? pinned : undefined
  return pinned ?? DEFAULT_WINDOW
}

function canonicalOf(model: string): string {
  return resolveRoute(model).canonical
}

export function acceptsThinkingDisable(model: string): boolean {
  const canonical = canonicalOf(model)
  return !MANDATORY_THINKING_PREFIXES.some((prefix) => canonical.startsWith(prefix))
}

export function supportsAdaptiveThinking(model: string): boolean {
  return !NO_ADAPTIVE_THINKING.has(canonicalOf(model))
}

function pickerRoutes(): readonly string[] {
  return Object.keys(CONTEXT_WINDOWS)
    .filter((canonical) => !ACCESS_GATED.has(canonical))
    .map(nativeModel)
}

/** The routes every account may be offered. Access-gated models come only from the account. */
export const PICKER_ROUTES: readonly string[] = pickerRoutes()
