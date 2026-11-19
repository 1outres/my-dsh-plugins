/** The part of a DOM rect the popover placement needs. */
export interface RectLike {
  left: number
  top: number
}

export interface ElementLike {
  getBoundingClientRect(): RectLike
}

export interface ViewportLike {
  readonly innerHeight: number
  addEventListener(type: "resize", listener: () => void): void
  removeEventListener(type: "resize", listener: () => void): void
}

export interface PopoverPosition {
  left: number
  bottom: number
}

/** Places the popover just above the bar, inside the viewport's horizontal padding. */
export function popoverPosition(rect: RectLike, viewportHeight: number): PopoverPosition {
  return { left: rect.left + 8, bottom: viewportHeight - rect.top + 4 }
}

/** Keeps the popover placement in step with the bar while it is open. */
export interface PositionTracker {
  getSnapshot(): PopoverPosition | null
  subscribe(listener: () => void): () => void
  follow(element: ElementLike, viewport: ViewportLike): () => void
}

export function createPositionTracker(): PositionTracker {
  let position: PopoverPosition | null = null
  let element: ElementLike | null = null
  let viewport: ViewportLike | null = null
  const listeners = new Set<() => void>()

  const measure = (): void => {
    if (element === null || viewport === null) return
    const next = popoverPosition(element.getBoundingClientRect(), viewport.innerHeight)
    if (position !== null && position.left === next.left && position.bottom === next.bottom) {
      return
    }
    position = next
    for (const listener of [...listeners]) listener()
  }

  return {
    getSnapshot: () => position,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    follow(target, view) {
      element = target
      viewport = view
      const onResize = (): void => measure()
      view.addEventListener("resize", onResize)
      measure()
      return () => {
        view.removeEventListener("resize", onResize)
        element = null
        viewport = null
      }
    },
  }
}
