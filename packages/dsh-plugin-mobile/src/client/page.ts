import type { Observable, PageState } from "./types"

export interface MediaQueryLike {
  readonly matches: boolean
  addEventListener(type: "change", listener: () => void): void
  removeEventListener(type: "change", listener: () => void): void
}

export type MatchMedia = (query: string) => MediaQueryLike

/** A phone or tablet without a precise pointer. */
export const TOUCH_QUERY = "(hover: none) and (pointer: coarse)"

/** A boolean value that can notify subscribers when it changes. */
export interface BooleanSource {
  get(): boolean
  subscribe(listener: () => void): () => void
  /** Release resources the source itself owns, such as DOM observers. */
  dispose?(): void
}

export interface PageSignals {
  /** Whether the Harness currently shows its navigation drawer. */
  readonly drawer: BooleanSource
  readonly touch: BooleanSource
}

export interface PageStore extends Observable<PageState> {
  dispose(): void
}

/** Combine the Harness drawer state and the pointer type into the page state. */
export function readPageState(drawer: boolean, touch: boolean): PageState {
  return { mobile: drawer, touch }
}

/** Wrap a media query as a boolean source. */
export function mediaSource(matchMedia: MatchMedia, query: string): BooleanSource {
  const media = matchMedia(query)
  return {
    get: () => media.matches,
    subscribe(listener) {
      media.addEventListener("change", listener)
      return () => {
        media.removeEventListener("change", listener)
      }
    },
  }
}

/**
 * Track the Harness drawer and the pointer type. The state object keeps its
 * identity while nothing changes, so React subscribers render only on a real
 * switch.
 */
export function createPageStore(signals: PageSignals): PageStore {
  const listeners = new Set<() => void>()
  let state: PageState = { mobile: false, touch: false }

  const compute = () => {
    const next = readPageState(signals.drawer.get(), signals.touch.get())
    if (next.mobile === state.mobile && next.touch === state.touch) return
    state = next
    for (const listener of [...listeners]) listener()
  }

  const offDrawer = signals.drawer.subscribe(compute)
  const offTouch = signals.touch.subscribe(compute)
  compute()

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      offDrawer()
      offTouch()
      signals.drawer.dispose?.()
      signals.touch.dispose?.()
      listeners.clear()
    },
  }
}
