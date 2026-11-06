import { FRAME_ANCHOR } from "./frame"
import type { BooleanSource } from "./page"

/** The frame attribute the Harness layout sets while it shows its navigation drawer. */
export const DRAWER_ATTRIBUTE = "data-sidebar-drawer"

export interface Observer {
  disconnect(): void
}

export interface DrawerSource extends BooleanSource {
  dispose(): void
}

export type Observe = (
  target: Node,
  options: MutationObserverInit,
  callback: () => void,
) => Observer

/** Create the browser observer the drawer source uses. */
export function observeMutations(
  target: Node,
  options: MutationObserverInit,
  callback: () => void,
): Observer {
  const observer = new MutationObserver(callback)
  observer.observe(target, options)
  return observer
}

/**
 * Track the frame's drawer attribute. The Harness measures the frame width
 * itself, so following the attribute keeps this plugin on the same side of the
 * 768px boundary even when a scrollbar makes the frame narrower than the
 * viewport.
 */
export function createDrawerSource(document: Document, observe: Observe): DrawerSource {
  const listeners = new Set<() => void>()
  let frame: Element | null = null
  let frameObserver: Observer | undefined
  let value = false

  const readFrame = (): Element | null =>
    document.querySelector(FRAME_ANCHOR)?.parentElement ?? null

  const refresh = () => {
    const next = frame?.hasAttribute(DRAWER_ATTRIBUTE) ?? false
    if (next === value) return
    value = next
    for (const listener of [...listeners]) listener()
  }

  const attach = () => {
    const next = readFrame()
    if (next === frame) {
      refresh()
      return
    }
    frameObserver?.disconnect()
    frame = next
    frameObserver =
      frame === null
        ? undefined
        : observe(frame, { attributes: true, attributeFilter: [DRAWER_ATTRIBUTE] }, refresh)
    refresh()
  }

  const documentObserver = observe(
    document.documentElement,
    { childList: true, subtree: true },
    () => {
      if (frame === null || frame.isConnected === false) attach()
    },
  )
  attach()

  return {
    get: () => value,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      documentObserver.disconnect()
      frameObserver?.disconnect()
      listeners.clear()
    },
  }
}
