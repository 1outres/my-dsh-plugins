/** Edge swipe to open the sidebar drawer, swipe left to close it. */

export type SwipeAction = "open" | "close"

export interface SwipeOptions {
  /** Width of the left-edge band, in CSS pixels, where an opening swipe starts. */
  readonly edge: number
  /** Horizontal travel needed to act. */
  readonly distance: number
  /** Travel after which the gesture commits to an axis. */
  readonly slop: number
}

export const DEFAULT_SWIPE: SwipeOptions = { edge: 24, distance: 56, slop: 10 }

export interface SwipeRecognizer {
  start(x: number, y: number, allowed: { open: boolean; close: boolean }): void
  move(x: number, y: number): void
  end(x: number, y: number): SwipeAction | null
  cancel(): void
}

interface Gesture {
  x: number
  y: number
  open: boolean
  close: boolean
  axis: "x" | "y" | undefined
}

/**
 * A pure recognizer over one touch. A gesture that turns vertical first is a
 * scroll and never acts.
 */
export function createSwipeRecognizer(options: SwipeOptions = DEFAULT_SWIPE): SwipeRecognizer {
  let gesture: Gesture | undefined

  const lock = (x: number, y: number) => {
    if (gesture === undefined || gesture.axis !== undefined) return
    const dx = Math.abs(x - gesture.x)
    const dy = Math.abs(y - gesture.y)
    if (dx < options.slop && dy < options.slop) return
    gesture.axis = dx > dy * 1.2 ? "x" : "y"
  }

  return {
    start(x, y, allowed) {
      const open = allowed.open && x <= options.edge
      gesture =
        open || allowed.close ? { x, y, open, close: allowed.close, axis: undefined } : undefined
    },
    move(x, y) {
      lock(x, y)
    },
    end(x, y) {
      lock(x, y)
      const current = gesture
      gesture = undefined
      if (current === undefined || current.axis !== "x") return null
      const dx = x - current.x
      if (Math.abs(y - current.y) > Math.abs(dx)) return null
      if (current.open && dx >= options.distance) return "open"
      if (current.close && dx <= -options.distance) return "close"
      return null
    },
    cancel() {
      gesture = undefined
    },
  }
}

export interface SwipeHost {
  /** Whether gestures are on (phone layout and the setting). */
  enabled(): boolean
  /** Whether the drawer is open now. */
  expanded(): boolean
  /** Whether a touch starting here must be left to the page. */
  blocked(target: EventTarget | null): boolean
  toggle(): void
}

interface TouchPoint {
  readonly clientX: number
  readonly clientY: number
}

interface TouchLike {
  readonly target: EventTarget | null
  readonly touches: ArrayLike<TouchPoint>
  readonly changedTouches: ArrayLike<TouchPoint>
}

interface TouchTarget {
  addEventListener(type: string, listener: (event: TouchLike) => void, options: object): void
  removeEventListener(type: string, listener: (event: TouchLike) => void, options: object): void
}

/**
 * Listen for drawer swipes on the document. Listeners are passive: scrolling
 * is never delayed or prevented.
 * @returns a disposer removing the listeners.
 */
export function installSwipe(
  target: TouchTarget,
  host: SwipeHost,
  options: SwipeOptions = DEFAULT_SWIPE,
): () => void {
  const recognizer = createSwipeRecognizer(options)
  const passive = { passive: true, capture: true }

  const onStart = (event: TouchLike) => {
    const touch = event.touches[0]
    if (!host.enabled() || event.touches.length !== 1 || touch === undefined) {
      recognizer.cancel()
      return
    }
    if (host.blocked(event.target)) {
      recognizer.cancel()
      return
    }
    const expanded = host.expanded()
    recognizer.start(touch.clientX, touch.clientY, { open: !expanded, close: expanded })
  }
  const onMove = (event: TouchLike) => {
    const touch = event.touches[0]
    if (event.touches.length !== 1 || touch === undefined) {
      recognizer.cancel()
      return
    }
    recognizer.move(touch.clientX, touch.clientY)
  }
  const onEnd = (event: TouchLike) => {
    const touch = event.changedTouches[0]
    if (touch === undefined) {
      recognizer.cancel()
      return
    }
    const action = recognizer.end(touch.clientX, touch.clientY)
    if (action === null || !host.enabled()) return
    const expanded = host.expanded()
    if ((action === "open" && !expanded) || (action === "close" && expanded)) host.toggle()
  }
  const onCancel = () => recognizer.cancel()

  target.addEventListener("touchstart", onStart, passive)
  target.addEventListener("touchmove", onMove, passive)
  target.addEventListener("touchend", onEnd, passive)
  target.addEventListener("touchcancel", onCancel, passive)
  return () => {
    target.removeEventListener("touchstart", onStart, passive)
    target.removeEventListener("touchmove", onMove, passive)
    target.removeEventListener("touchend", onEnd, passive)
    target.removeEventListener("touchcancel", onCancel, passive)
  }
}
