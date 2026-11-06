import { refKey } from "./config"
import type { StorageEventLike, StorageEventTarget, StorageLike } from "./recent"
import type { ModelRef } from "./types"

/** Browser storage key. Versioned so a format change can start over. */
export const EFFORTS_STORAGE_KEY = "dsh-plugin-model-picker:efforts:v1"

/** Models whose effort is remembered, most recently used first. */
export const EFFORTS_STORED = 200

/** One remembered choice: the reasoning level last used with a model. */
export interface StoredEffort extends ModelRef {
  effort: string
}

/** The reasoning level last chosen for each model. */
export interface EffortStore {
  /** Start following other tabs' writes; returns the disposer. */
  connect(): () => void
  /** The level remembered for a model, or undefined when it has none. */
  get(ref: ModelRef): string | undefined
  /**
   * Remember a model's level. Undefined forgets it, so a model explicitly
   * reset to Default does not return to an older level.
   */
  remember(ref: ModelRef, effort: string | undefined): void
}

/** Keep the well-formed choices of an untrusted list, first occurrence wins. */
export function normalizeEfforts(value: unknown): StoredEffort[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const efforts: StoredEffort[] = []
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue
    const { provider, model, effort } = item as Record<string, unknown>
    if (typeof provider !== "string" || typeof model !== "string") continue
    if (typeof effort !== "string") continue
    if (provider.length === 0 || model.length === 0 || effort.length === 0) continue
    const key = refKey(provider, model)
    if (seen.has(key)) continue
    seen.add(key)
    efforts.push({ provider, model, effort })
  }
  return efforts
}

/** Whether two lists hold the same pairs and levels in the same order. */
function sameEfforts(left: readonly StoredEffort[], right: readonly StoredEffort[]): boolean {
  if (left.length !== right.length) return false
  return left.every(
    (item, index) =>
      item.provider === right[index]?.provider &&
      item.model === right[index]?.model &&
      item.effort === right[index]?.effort,
  )
}

/**
 * Keep each model's effort in browser storage. Storage may be missing or
 * refuse access; the choices then live for this page only.
 */
export function createEffortStore(
  storage: StorageLike | undefined,
  events?: StorageEventTarget,
): EffortStore {
  const read = (): readonly StoredEffort[] => {
    if (storage === undefined) return []
    try {
      const raw = storage.getItem(EFFORTS_STORAGE_KEY)
      return raw === null ? [] : normalizeEfforts(JSON.parse(raw)).slice(0, EFFORTS_STORED)
    } catch {
      return []
    }
  }

  let snapshot = read()

  const replace = (next: readonly StoredEffort[]) => {
    if (sameEfforts(next, snapshot)) return
    snapshot = next
  }

  return {
    connect() {
      if (events === undefined) return () => {}
      const onStorage = (event: StorageEventLike) => {
        if (event.key === null || event.key === EFFORTS_STORAGE_KEY) replace(read())
      }
      events.addEventListener("storage", onStorage)
      return () => {
        events.removeEventListener("storage", onStorage)
      }
    },
    get(ref) {
      const key = refKey(ref.provider, ref.model)
      return snapshot.find((item) => refKey(item.provider, item.model) === key)?.effort
    },
    remember(ref, effort) {
      const key = refKey(ref.provider, ref.model)
      const kept = snapshot.filter((item) => refKey(item.provider, item.model) !== key)
      const next =
        effort === undefined
          ? kept
          : [{ provider: ref.provider, model: ref.model, effort }, ...kept].slice(0, EFFORTS_STORED)
      try {
        storage?.setItem(EFFORTS_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // Quota or privacy settings: keep the in-memory choices.
      }
      replace(next)
    },
  }
}
