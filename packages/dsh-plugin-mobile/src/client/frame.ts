/**
 * The three-column AppFrame of `@deepseek-ai/dsh-client-ui-layout`, found by its
 * right column marker. The frame publishes the sidebar and right panel state as
 * attributes; the plugin reads them and never writes to the frame.
 */
/** The right column marker that finds the frame. */
export const FRAME_ANCHOR = "[data-rightbar-col]"
export const COLLAPSED_ATTRIBUTE = "data-sidebar-collapsed"
export const FULLSCREEN_ATTRIBUTE = "data-rightbar-fullscreen"
/** The `data-shortcut-modal` value of the Harness navigation drawer. */
const DRAWER_MODAL = "sidebar"

interface FlagElement {
  hasAttribute(name: string): boolean
}

interface ElementLike {
  readonly parentElement: FlagElement | null
}

interface QueryRoot {
  querySelector(selector: string): ElementLike | null
}

export function findFrame(root: QueryRoot): FlagElement | null {
  return root.querySelector(FRAME_ANCHOR)?.parentElement ?? null
}

/** Whether the sidebar is expanded; false while the frame is not mounted. */
export function isExpanded(frame: FlagElement | null): boolean {
  return frame !== null && !frame.hasAttribute(COLLAPSED_ATTRIBUTE)
}

/** Touches starting inside these are left to the page. */
export const NO_SWIPE =
  "pre, table, input, textarea, select, [contenteditable='true'], [role='slider'], [data-sidebar-opener], [data-sidebar-toggle], [data-dsh-mobile-no-swipe]"

interface ScrollProbe {
  readonly scrollWidth: number
  readonly clientWidth: number
  readonly parentElement: ScrollProbe | null
  closest(selector: string): unknown
}

/**
 * Both the Harness navigation drawer and a dialog can be modal at once, so
 * exclude the drawer by selector instead of reading the first modal's name.
 */
const OTHER_MODAL = `[aria-modal='true']:not([data-shortcut-modal='${DRAWER_MODAL}'])`

/** Whether a modal other than the navigation drawer owns the page. */
function otherModalOpen(root: QueryRoot): boolean {
  return root.querySelector(OTHER_MODAL) !== null
}

/**
 * Whether a touch target sits in something that scrolls sideways, in a form
 * control, while a modal other than the drawer is open, or while the right
 * panel covers the screen.
 */
export function swipeBlocked(
  target: EventTarget | null,
  root: QueryRoot,
  overflowX: (element: ScrollProbe) => string,
): boolean {
  if (findFrame(root)?.hasAttribute(FULLSCREEN_ATTRIBUTE) === true) return true
  if (otherModalOpen(root)) return true
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
