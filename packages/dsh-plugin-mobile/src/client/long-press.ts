/** Long press opens the Harness context menu on a touch screen. */

export interface LongPressOptions {
  /** How long the finger stays down before the menu opens, in milliseconds. */
  readonly delay: number
  /** How far the finger may travel before the press is cancelled, in CSS pixels. */
  readonly slop: number
  /** How long after the finger lifts a leftover click stays suppressed, in milliseconds. */
  readonly clickWindow: number
}

export const DEFAULT_LONG_PRESS: LongPressOptions = { delay: 500, slop: 10, clickWindow: 700 }

export interface LongPressHost {
  /** Whether long presses are on (a touch screen and the setting). */
  enabled(): boolean
  /** Whether a touch starting here must be left to the browser. */
  ignored(target: EventTarget | null): boolean
  /** Open the Harness menu at this point; true when a menu took the event. */
  open(target: EventTarget | null, x: number, y: number): boolean
  clearSelection(): void
  /** Mark the page so the browser stops starting a text selection. */
  lockSelection(locked: boolean): void
}

export type TimerHandle = ReturnType<typeof setTimeout>

export interface LongPressTimers {
  setTimeout(handler: () => void, ms: number): TimerHandle
  clearTimeout(handle: TimerHandle): void
}

const BROWSER_TIMERS: LongPressTimers = {
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
}

/** A long press here belongs to the element: text selection or a form control. */
const IGNORED =
  "input, textarea, select, [role='menu'], [contenteditable]:not([contenteditable='false'])"

interface ClosestTarget {
  closest(selector: string): unknown
}

function asTarget(target: unknown): ClosestTarget | null {
  const candidate = target as Partial<ClosestTarget> | null
  return candidate !== null && typeof candidate?.closest === "function"
    ? (candidate as ClosestTarget)
    : null
}

/** Whether a touch here keeps its own long press. */
export function longPressIgnored(target: unknown): boolean {
  const element = asTarget(target)
  return element !== null && element.closest(IGNORED) !== null
}

interface TouchPoint {
  readonly clientX: number
  readonly clientY: number
}

interface TouchLike {
  readonly target: EventTarget | null
  readonly touches: ArrayLike<TouchPoint>
}

interface MenuEventLike {
  readonly isTrusted: boolean
  readonly defaultPrevented: boolean
  preventDefault(): void
  stopImmediatePropagation(): void
}

interface LongPressTarget {
  addEventListener(
    type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
    listener: (event: TouchLike) => void,
    options: object,
  ): void
  addEventListener(
    type: "contextmenu" | "click" | "selectstart" | "selectionchange",
    listener: (event: MenuEventLike) => void,
    options: object,
  ): void
  removeEventListener(
    type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
    listener: (event: TouchLike) => void,
    options: object,
  ): void
  removeEventListener(
    type: "contextmenu" | "click" | "selectstart" | "selectionchange",
    listener: (event: MenuEventLike) => void,
    options: object,
  ): void
}

interface Press {
  readonly target: EventTarget | null
  readonly x: number
  readonly y: number
  readonly generation: number
  handle?: TimerHandle
}

/**
 * Open the Harness context menu after a long press on a touch screen. Listeners
 * are passive, so scrolling is never delayed.
 * @returns a disposer removing the listeners.
 */
export function installLongPress(
  target: LongPressTarget,
  host: LongPressHost,
  timers: LongPressTimers = BROWSER_TIMERS,
  options: LongPressOptions = DEFAULT_LONG_PRESS,
): () => void {
  const passive = { passive: true, capture: true }
  const capture = { capture: true }
  let press: Press | undefined
  let fingerDown = false
  let blockNative = false
  let suppressClick = false
  let selectionLocked = false
  let clickWindowTimer: TimerHandle | undefined
  let generation = 0

  const cancel = () => {
    if (press === undefined) return
    if (press.handle !== undefined) timers.clearTimeout(press.handle)
    press = undefined
  }

  const clearClickWindow = () => {
    if (clickWindowTimer === undefined) return
    timers.clearTimeout(clickWindowTimer)
    clickWindowTimer = undefined
  }

  const startClickWindow = () => {
    if (!suppressClick || clickWindowTimer !== undefined) return
    clickWindowTimer = timers.setTimeout(() => {
      clickWindowTimer = undefined
      suppressClick = false
    }, options.clickWindow)
  }

  const setSelectionLock = (locked: boolean) => {
    if (selectionLocked === locked) return
    selectionLocked = locked
    host.lockSelection(locked)
  }

  const guardPress = () => {
    blockNative = true
    suppressClick = true
    setSelectionLock(true)
  }

  const openPress = (pressed: Press): boolean => {
    if (press !== pressed) return false
    cancel()
    if (!host.open(pressed.target, pressed.x, pressed.y)) return false
    guardPress()
    host.clearSelection()
    return true
  }

  const onStart = (event: TouchLike) => {
    cancel()
    clearClickWindow()
    generation += 1
    fingerDown = true
    blockNative = false
    suppressClick = false
    setSelectionLock(false)
    const touch = event.touches[0]
    if (!host.enabled() || event.touches.length !== 1 || touch === undefined) return
    if (host.ignored(event.target)) return
    const pressed: Press = {
      target: event.target,
      x: touch.clientX,
      y: touch.clientY,
      generation,
    }
    press = pressed
    pressed.handle = timers.setTimeout(() => openPress(pressed), options.delay)
  }

  const onMove = (event: TouchLike) => {
    if (press === undefined) return
    const touch = event.touches[0]
    if (event.touches.length !== 1 || touch === undefined) {
      cancel()
      return
    }
    if (
      Math.abs(touch.clientX - press.x) > options.slop ||
      Math.abs(touch.clientY - press.y) > options.slop
    ) {
      cancel()
    }
  }

  const onEnd = () => {
    cancel()
    fingerDown = false
    blockNative = false
    startClickWindow()
    setSelectionLock(false)
  }

  const onContextMenu = (event: MenuEventLike) => {
    if (!event.isTrusted) return
    if (press !== undefined) {
      const current = generation
      cancel()
      timers.setTimeout(() => {
        if (!event.defaultPrevented || generation !== current || !fingerDown) return
        guardPress()
        host.clearSelection()
      }, 0)
      return
    }
    if (!blockNative) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  const onSelectStart = (event: MenuEventLike) => {
    if (press !== undefined) {
      if (openPress(press)) event.preventDefault()
      return
    }
    if (blockNative) event.preventDefault()
  }

  const onSelectionChange = () => {
    if (!blockNative) return
    host.clearSelection()
  }

  const onClick = (event: MenuEventLike) => {
    if (!suppressClick) return
    suppressClick = false
    clearClickWindow()
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  target.addEventListener("touchstart", onStart, passive)
  target.addEventListener("touchmove", onMove, passive)
  target.addEventListener("touchend", onEnd, passive)
  target.addEventListener("touchcancel", onEnd, passive)
  target.addEventListener("contextmenu", onContextMenu, capture)
  target.addEventListener("selectstart", onSelectStart, capture)
  target.addEventListener("selectionchange", onSelectionChange, capture)
  target.addEventListener("click", onClick, capture)
  return () => {
    cancel()
    clearClickWindow()
    setSelectionLock(false)
    target.removeEventListener("touchstart", onStart, passive)
    target.removeEventListener("touchmove", onMove, passive)
    target.removeEventListener("touchend", onEnd, passive)
    target.removeEventListener("touchcancel", onEnd, passive)
    target.removeEventListener("contextmenu", onContextMenu, capture)
    target.removeEventListener("selectstart", onSelectStart, capture)
    target.removeEventListener("selectionchange", onSelectionChange, capture)
    target.removeEventListener("click", onClick, capture)
  }
}

export type ContextMenuEventConstructor = (type: "contextmenu", init: MouseEventInit) => MouseEvent

function createContextMenuEvent(type: "contextmenu", init: MouseEventInit): MouseEvent {
  return new MouseEvent(type, init)
}

/**
 * Dispatch a contextmenu event at the touched element, as the Harness
 * context-menu plugin expects. React 18 delegates events at its root, so the
 * native event reaches onContextMenu.
 * @returns whether a menu took the event.
 */
export function dispatchContextMenu(
  target: EventTarget | null,
  x: number,
  y: number,
  create: ContextMenuEventConstructor = createContextMenuEvent,
): boolean {
  if (target === null) return false
  const event = create("contextmenu", {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    button: 2,
  })
  target.dispatchEvent(event)
  return event.defaultPrevented
}
