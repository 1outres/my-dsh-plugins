/** The part of a DOM rect the popover placement needs. */
export interface RectLike {
  left: number
  top: number
  right: number
  bottom: number
  width: number
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
  width?: number
}

/** Places the popover above a wide row, or to the right of the rail row. */
export function popoverPosition(
  rect: RectLike,
  viewportHeight: number,
  wide: boolean,
): PopoverPosition {
  if (wide) {
    return {
      left: rect.left,
      bottom: viewportHeight - rect.top + 4,
      width: Math.min(260, rect.width),
    }
  }
  return { left: rect.right + 8, bottom: viewportHeight - rect.bottom }
}

/** Keeps the popover placement in step with the row while it is open. */
export interface PositionTracker {
  getSnapshot(): PopoverPosition | null
  subscribe(listener: () => void): () => void
  follow(element: ElementLike, viewport: ViewportLike, wide: boolean): () => void
}

export function createPositionTracker(): PositionTracker {
  let position: PopoverPosition | null = null
  let element: ElementLike | null = null
  let viewport: ViewportLike | null = null
  let wide = true
  const listeners = new Set<() => void>()

  const measure = (): void => {
    if (element === null || viewport === null) return
    const next = popoverPosition(element.getBoundingClientRect(), viewport.innerHeight, wide)
    if (
      position !== null &&
      position.left === next.left &&
      position.bottom === next.bottom &&
      position.width === next.width
    ) {
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
    follow(target, view, nextWide) {
      element = target
      viewport = view
      wide = nextWide
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
