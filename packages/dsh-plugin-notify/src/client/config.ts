import type { NotifyConfig } from "./types"

/**
 * The profile entry id in the bundle patch. It is also the settings namespace
 * the browser half reads, so the two halves must agree on it.
 */
export const CONFIG_NAMESPACE = "notify"

/** Shown when a field was never written (schema defaults live in the host half). */
export const DEFAULT_CONFIG: NotifyConfig = {
  enabled: true,
  onlyWhenUnfocused: true,
  approval: true,
  question: true,
  completion: true,
  showDetail: true,
}

/** Coerce one Host section into the shape the browser half expects. */
export function normalizeConfig(value: Partial<NotifyConfig> | undefined): NotifyConfig {
  const read = (field: keyof NotifyConfig): boolean => {
    const current = value?.[field]
    return typeof current === "boolean" ? current : DEFAULT_CONFIG[field]
  }
  return {
    enabled: read("enabled"),
    onlyWhenUnfocused: read("onlyWhenUnfocused"),
    approval: read("approval"),
    question: read("question"),
    completion: read("completion"),
    showDetail: read("showDetail"),
  }
}
