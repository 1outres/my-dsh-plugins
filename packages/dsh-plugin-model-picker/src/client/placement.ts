/** Where the menu goes, and whether the page is on a touch screen. */

/** The visible part of the page, in the coordinates fixed elements use. */
export interface ViewBox {
  left: number
  top: number
  width: number
  height: number
}

export interface MenuPlacement {
  left: number
  top: number
  /** Tallest the menu may grow without covering its trigger. */
  maxHeight: number
}

export interface PlacementOptions {
  margin: number
  gap: number
  /** Below this much room above the trigger the menu may overlap it instead. */
  minHeight: number
}

export const DEFAULT_PLACEMENT: PlacementOptions = { margin: 12, gap: 8, minHeight: 160 }

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high)
}

/**
 * Put the menu above the trigger, right-aligned, inside the visible box. The
 * menu is capped to the room above the trigger so its bottom rows (Effort)
 * stay on screen even when an on-screen keyboard takes half the page.
 */
export function placeMenu(
  trigger: { top: number; right: number },
  size: { width: number; height: number },
  view: ViewBox,
  options: PlacementOptions = DEFAULT_PLACEMENT,
): MenuPlacement {
  const { margin, gap, minHeight } = options
  const room = Math.floor(trigger.top - gap - (view.top + margin))
  const maxHeight = room >= minHeight ? room : Math.max(minHeight, view.height - 2 * margin)
  const height = Math.min(size.height, maxHeight)
  let left = trigger.right - size.width
  let top = trigger.top - gap - height
  if (size.width > 0)
    left = clamp(left, view.left + margin, view.left + view.width - size.width - margin)
  if (height > 0) top = clamp(top, view.top + margin, view.top + view.height - height - margin)
  return { left, top, maxHeight }
}

interface VisualViewportLike {
  readonly offsetLeft: number
  readonly offsetTop: number
  readonly width: number
  readonly height: number
}

interface WindowLike {
  readonly innerWidth: number
  readonly innerHeight: number
  readonly visualViewport?: VisualViewportLike | null
  matchMedia?(query: string): { matches: boolean }
}

/** The visual viewport when the browser has one: it excludes the on-screen keyboard. */
export function viewBoxOf(win: WindowLike): ViewBox {
  const view = win.visualViewport
  if (view === undefined || view === null) {
    return { left: 0, top: 0, width: win.innerWidth, height: win.innerHeight }
  }
  return { left: view.offsetLeft, top: view.offsetTop, width: view.width, height: view.height }
}

/**
 * A phone or tablet without a precise pointer. Focusing a field there opens
 * the on-screen keyboard, and dismissing the keyboard blurs the field.
 */
export function isCoarsePointer(win: WindowLike | undefined): boolean {
  try {
    return win?.matchMedia?.("(hover: none) and (pointer: coarse)").matches === true
  } catch {
    return false
  }
}
