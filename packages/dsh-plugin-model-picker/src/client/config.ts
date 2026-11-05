import type { ModelPickerConfig, ModelRef } from "./types"

/**
 * The profile entry id in the bundle patch. It is also the settings namespace
 * and the locale namespace, so both halves must agree on it.
 */
export const CONFIG_NAMESPACE = "model-picker"

/** Shown when a field was never written (schema defaults live in the host half). */
export const DEFAULT_CONFIG: ModelPickerConfig = { favorites: [] }

/** Key of one provider/model pair. JSON keeps ids that contain `/` unambiguous. */
export function refKey(provider: string, model: string): string {
  return JSON.stringify([provider, model])
}

/**
 * Keep the well-formed provider/model pairs of an untrusted list, first
 * occurrence wins.
 */
export function normalizeRefs(value: unknown): ModelRef[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const refs: ModelRef[] = []
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue
    const { provider, model } = item as Record<string, unknown>
    if (typeof provider !== "string" || typeof model !== "string") continue
    if (provider.length === 0 || model.length === 0) continue
    const key = refKey(provider, model)
    if (seen.has(key)) continue
    seen.add(key)
    refs.push({ provider, model })
  }
  return refs
}

/** Coerce one Host section into the shape the browser half expects. */
export function normalizeConfig(value: Partial<ModelPickerConfig> | undefined): ModelPickerConfig {
  return { favorites: normalizeRefs(value?.favorites) }
}

/** Whether two lists hold the same pairs in the same order. */
export function sameRefs(left: readonly ModelRef[], right: readonly ModelRef[]): boolean {
  if (left.length !== right.length) return false
  return left.every(
    (ref, index) => ref.provider === right[index]?.provider && ref.model === right[index]?.model,
  )
}
