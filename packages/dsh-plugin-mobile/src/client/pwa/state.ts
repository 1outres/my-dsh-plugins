import type { PwaPlatform, PwaState, PwaStore } from "../types"

export const INITIAL_PWA_STATE: PwaState = {
  worker: "off",
  standalone: false,
  installable: false,
  platform: "other",
}

/**
 * Detect iOS and iPadOS. iPadOS reports a desktop Safari user agent, so a Mac
 * with a touch screen counts as iPad.
 */
export function detectPlatform(
  userAgent: string,
  platform: string,
  maxTouchPoints: number,
): PwaPlatform {
  if (/iphone|ipad|ipod/i.test(userAgent)) return "ios"
  if (platform === "MacIntel" && maxTouchPoints > 1) return "ios"
  return "other"
}

/** A state store that only notifies when a value really changes. */
export function createPwaStore(): PwaStore {
  const listeners = new Set<() => void>()
  let state = INITIAL_PWA_STATE

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    update(next) {
      const merged = { ...state, ...next }
      if (
        merged.worker === state.worker &&
        merged.standalone === state.standalone &&
        merged.installable === state.installable &&
        merged.platform === state.platform
      ) {
        return
      }
      state = merged
      for (const listener of [...listeners]) listener()
    },
  }
}
