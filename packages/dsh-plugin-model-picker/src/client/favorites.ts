import { normalizeConfig, sameRefs } from "./config"
import { toggleRef } from "./model"
import type { ConfigForm, ModelPickerConfig, ModelRef, Observable } from "./types"

/** Favorite models over the plugin's settings entry. */
export interface FavoritesStore extends Observable<readonly ModelRef[]> {
  /** Start following the settings entry; returns the disposer. */
  connect(): () => void
  /**
   * Add or remove one model. The list updates at once and settles on the
   * Host's answer.
   * @returns whether the Host accepted the write.
   */
  toggle(ref: ModelRef): Promise<boolean>
}

/**
 * Follow `favorites` in one config form. A toggle shows its result
 * immediately; the latest write's settlement replaces that optimistic list
 * with the Host's.
 */
export function createFavoritesStore(form: ConfigForm<ModelPickerConfig>): FavoritesStore {
  const listeners = new Set<() => void>()
  const read = () => normalizeConfig(form.getSnapshot().value).favorites
  let confirmed: readonly ModelRef[] = read()
  let optimistic: readonly ModelRef[] | undefined
  let snapshot: readonly ModelRef[] = confirmed
  let generation = 0

  const publish = () => {
    const next = optimistic ?? confirmed
    if (next === snapshot) return
    snapshot = next
    for (const listener of [...listeners]) listener()
  }

  const refresh = () => {
    const next = read()
    if (!sameRefs(next, confirmed)) confirmed = next
    publish()
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    connect() {
      refresh()
      return form.subscribe(refresh)
    },
    async toggle(ref) {
      const state = form.getSnapshot()
      if (state.status !== "ready" || !state.writable) return false
      const next = toggleRef(optimistic ?? confirmed, ref)
      const ticket = ++generation
      optimistic = next
      publish()
      let accepted = false
      try {
        accepted = await form.set("favorites", next)
      } catch {
        accepted = false
      }
      if (ticket === generation) {
        optimistic = undefined
        if (accepted && !sameRefs(next, confirmed)) confirmed = next
        publish()
      }
      return accepted
    },
  }
}
