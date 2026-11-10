import type { BooleanSetting, ConfigForm, EnterKey, MobileConfig } from "./types"

/**
 * The profile entry id in the bundle patch. It is also the settings namespace
 * the browser half reads and the locale namespace, so they must agree.
 */
export const NAMESPACE = "mobile"

/** Used for a field that was never written (schema defaults live in the host half). */
export const DEFAULT_CONFIG: MobileConfig = {
  enterKey: "newline",
  swipe: true,
  fitKeyboard: true,
  blockPullToRefresh: true,
  autoFocusComposer: false,
  serviceWorker: true,
  themeColor: true,
}

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
  return {
    enterKey: oneOf(value?.enterKey, ENTER_KEYS, DEFAULT_CONFIG.enterKey),
    swipe: flag(value?.swipe, DEFAULT_CONFIG.swipe),
    fitKeyboard: flag(value?.fitKeyboard, DEFAULT_CONFIG.fitKeyboard),
    blockPullToRefresh: flag(value?.blockPullToRefresh, DEFAULT_CONFIG.blockPullToRefresh),
    autoFocusComposer: flag(value?.autoFocusComposer, DEFAULT_CONFIG.autoFocusComposer),
    serviceWorker: flag(value?.serviceWorker, DEFAULT_CONFIG.serviceWorker),
    themeColor: flag(value?.themeColor, DEFAULT_CONFIG.themeColor),
  }
}

/** The boolean fields of the settings. */
export type BooleanField = {
  [K in keyof MobileConfig]-?: MobileConfig[K] extends boolean ? K : never
}[keyof MobileConfig]

/**
 * Follow one boolean setting. The value is read at decision time, so a change
 * applies without restarting the browser half.
 */
export function booleanSetting(
  form: ConfigForm<Partial<MobileConfig>>,
  field: BooleanField,
): BooleanSetting {
  return {
    get: () => normalizeConfig(form.getSnapshot().value)[field],
    subscribe: (listener) => form.subscribe(listener),
  }
}
