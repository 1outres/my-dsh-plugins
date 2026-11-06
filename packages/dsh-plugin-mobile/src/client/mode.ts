import type { LayoutMode, MobileConfig, ModeState, Observable } from "./types"

export interface MediaQueryLike {
  readonly matches: boolean
  addEventListener(type: "change", listener: () => void): void
  removeEventListener(type: "change", listener: () => void): void
}

export type MatchMedia = (query: string) => MediaQueryLike

/** A phone or tablet without a precise pointer. */
export const TOUCH_QUERY = "(hover: none) and (pointer: coarse)"

/** Matches while the viewport is narrower than `breakpoint` CSS pixels. */
export function widthQuery(breakpoint: number): string {
  return `(max-width: ${breakpoint - 0.02}px)`
}

/** Whether the phone layout applies for a mode and the current width match. */
export function resolveMobile(mode: LayoutMode, narrow: boolean): boolean {
  if (mode === "always") return true
  if (mode === "off") return false
  return narrow
}

export interface ModeStore extends Observable<ModeState> {
  /** Re-read the settings; call after they change. */
  refresh(): void
  dispose(): void
}

/**
 * Track the phone-layout decision. The state object keeps its identity while
 * nothing changes, so React subscribers render only on a real switch.
 */
export function createModeStore(matchMedia: MatchMedia, config: () => MobileConfig): ModeStore {
  const listeners = new Set<() => void>()
  const touch = matchMedia(TOUCH_QUERY)
  let breakpoint = config().breakpoint
  let width = matchMedia(widthQuery(breakpoint))
  let state: ModeState = { mobile: false, touch: false }

  const compute = () => {
    const next: ModeState = {
      mobile: resolveMobile(config().mode, width.matches),
      touch: touch.matches,
    }
    if (next.mobile === state.mobile && next.touch === state.touch) return
    state = next
    for (const listener of [...listeners]) listener()
  }

  const onChange = () => compute()
  touch.addEventListener("change", onChange)
  width.addEventListener("change", onChange)
  compute()

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    refresh() {
      const next = config().breakpoint
      if (next !== breakpoint) {
        width.removeEventListener("change", onChange)
        breakpoint = next
        width = matchMedia(widthQuery(breakpoint))
        width.addEventListener("change", onChange)
      }
      compute()
    },
    dispose() {
      touch.removeEventListener("change", onChange)
      width.removeEventListener("change", onChange)
      listeners.clear()
    },
  }
}
