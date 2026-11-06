import type { EnterKey, LayoutMode, MobileConfig } from "./types"

/**
 * The profile entry id in the bundle patch. It is also the settings namespace
 * the browser half reads and the locale namespace, so they must agree.
 */
export const NAMESPACE = "mobile"

export const MIN_BREAKPOINT = 360
export const MAX_BREAKPOINT = 1024

/** Used for a field that was never written (schema defaults live in the host half). */
export const DEFAULT_CONFIG: MobileConfig = {
  mode: "auto",
  breakpoint: 768,
  enterKey: "newline",
  swipe: true,
  fitKeyboard: true,
  blockPullToRefresh: true,
}

const MODES: readonly LayoutMode[] = ["auto", "always", "off"]
const ENTER_KEYS: readonly EnterKey[] = ["newline", "send"]

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

/** Coerce one Host section into the shape the browser half expects. */
export function normalizeConfig(
  value: Partial<Record<keyof MobileConfig, unknown>> | undefined,
): MobileConfig {
  const breakpoint =
    typeof value?.breakpoint === "number" && Number.isFinite(value.breakpoint)
      ? Math.round(Math.min(MAX_BREAKPOINT, Math.max(MIN_BREAKPOINT, value.breakpoint)))
      : DEFAULT_CONFIG.breakpoint
  return {
    mode: oneOf(value?.mode, MODES, DEFAULT_CONFIG.mode),
    breakpoint,
    enterKey: oneOf(value?.enterKey, ENTER_KEYS, DEFAULT_CONFIG.enterKey),
    swipe: flag(value?.swipe, DEFAULT_CONFIG.swipe),
    fitKeyboard: flag(value?.fitKeyboard, DEFAULT_CONFIG.fitKeyboard),
    blockPullToRefresh: flag(value?.blockPullToRefresh, DEFAULT_CONFIG.blockPullToRefresh),
  }
}
