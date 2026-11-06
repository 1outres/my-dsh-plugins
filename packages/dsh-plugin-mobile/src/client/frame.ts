import { type RefObject, useCallback, useSyncExternalStore } from "react"

/**
 * The three-column AppFrame of `@deepseek-ai/dsh-client-ui-layout`, found by its
 * right column marker. The frame publishes the sidebar and right panel state as
 * attributes; the plugin reads them and never writes to the frame.
 */
export const FRAME = "div:has(> [data-rightbar-col])"
export const COLLAPSED_ATTRIBUTE = "data-sidebar-collapsed"
export const FULLSCREEN_ATTRIBUTE = "data-rightbar-fullscreen"

interface FlagElement {
  hasAttribute(name: string): boolean
}

interface QueryRoot {
  querySelector(selector: string): { parentElement: FlagElement | null } | null
}

export function findFrame(root: QueryRoot): FlagElement | null {
  return root.querySelector("[data-rightbar-col]")?.parentElement ?? null
}

/** Whether the sidebar is expanded; false while the frame is not mounted. */
export function isExpanded(frame: FlagElement | null): boolean {
  return frame !== null && !frame.hasAttribute(COLLAPSED_ATTRIBUTE)
}

/** Touches starting inside these are left to the page. */
export const NO_SWIPE =
  "pre, table, input, textarea, select, [contenteditable='true'], [role='slider'], [data-dsh-mobile-no-swipe]"

interface ScrollProbe {
  readonly scrollWidth: number
  readonly clientWidth: number
  readonly parentElement: ScrollProbe | null
  closest(selector: string): unknown
}

/**
 * Whether a touch target sits in something that scrolls sideways, in a form
 * control, while a modal is open, or while the right panel covers the screen.
 */
export function swipeBlocked(
  target: EventTarget | null,
  root: QueryRoot,
  overflowX: (element: ScrollProbe) => string,
): boolean {
  if (findFrame(root)?.hasAttribute(FULLSCREEN_ATTRIBUTE) === true) return true
  if (root.querySelector("[aria-modal='true']") !== null) return true
  const element = target as ScrollProbe | null
  if (element === null || typeof element.closest !== "function") return false
  if (element.closest(NO_SWIPE) !== null) return true
  let current: ScrollProbe | null = element
  for (let depth = 0; current !== null && depth < 12; depth += 1) {
    if (current.scrollWidth > current.clientWidth + 1) {
      const overflow = overflowX(current)
      if (overflow === "auto" || overflow === "scroll") return true
    }
    current = current.parentElement
  }
  return false
}

/**
 * Read one frame attribute from a component rendered inside the frame.
 * @param anchor - an element of the component, used to find its frame.
 * @returns whether the attribute is present, or undefined before mount.
 */
export function useFrameFlag(
  anchor: RefObject<Element | null>,
  attribute: string,
): boolean | undefined {
  const subscribe = useCallback(
    (listener: () => void) => {
      const frame = anchor.current?.closest(FRAME)
      if (frame === undefined || frame === null) return () => {}
      const observer = new MutationObserver(listener)
      observer.observe(frame, { attributes: true, attributeFilter: [attribute] })
      return () => observer.disconnect()
    },
    [anchor, attribute],
  )
  const read = useCallback(
    () => anchor.current?.closest(FRAME)?.hasAttribute(attribute),
    [anchor, attribute],
  )
  return useSyncExternalStore(subscribe, read, () => undefined)
}
