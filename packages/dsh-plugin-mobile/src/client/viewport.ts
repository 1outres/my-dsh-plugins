/** Viewport metadata and the on-screen keyboard. */

/**
 * Keys added to the viewport metadata: draw under notches (the stylesheet pads
 * by the safe-area insets) and let Chromium shrink the layout for the keyboard.
 */
export const VIEWPORT_ADDITIONS: Readonly<Record<string, string>> = {
  "viewport-fit": "cover",
  "interactive-widget": "resizes-content",
}

/** Home-screen metadata; existing tags with the same name are left alone. */
export const APP_META: readonly (readonly [string, string])[] = [
  ["apple-mobile-web-app-capable", "yes"],
  ["mobile-web-app-capable", "yes"],
  ["apple-mobile-web-app-title", "DSH"],
]

/**
 * Set keys in a viewport `content` string, keeping the order and every other key.
 * @returns the merged content.
 */
export function mergeViewportContent(
  content: string,
  additions: Readonly<Record<string, string>>,
): string {
  const entries: [string, string][] = []
  for (const part of content.split(",")) {
    const [rawKey, ...rest] = part.split("=")
    const key = rawKey?.trim().toLowerCase() ?? ""
    if (key.length === 0) continue
    entries.push([key, rest.join("=").trim()])
  }
  for (const [key, value] of Object.entries(additions)) {
    const found = entries.find((entry) => entry[0] === key)
    if (found === undefined) entries.push([key, value])
    else found[1] = value
  }
  return entries.map(([key, value]) => (value.length > 0 ? `${key}=${value}` : key)).join(", ")
}

interface MetaDocument {
  readonly head: { append(node: unknown): void }
  querySelector(selector: string): MetaElement | null
  createElement(tag: "meta"): MetaElement
}

interface MetaElement {
  name: string
  content: string
  dataset: Record<string, string | undefined>
  remove(): void
}

const OWNER = "@1outres/dsh-plugin-mobile"

/**
 * Patch the viewport metadata and add the home-screen tags.
 * @returns a disposer restoring the original viewport content and removing added tags.
 */
export function installMeta(doc: MetaDocument): () => void {
  const added: MetaElement[] = []
  let viewport = doc.querySelector('meta[name="viewport"]')
  let original: string | undefined
  if (viewport === null) {
    viewport = doc.createElement("meta")
    viewport.name = "viewport"
    viewport.content = mergeViewportContent(
      "width=device-width, initial-scale=1",
      VIEWPORT_ADDITIONS,
    )
    viewport.dataset.plugin = OWNER
    doc.head.append(viewport)
    added.push(viewport)
  } else {
    original = viewport.content
    viewport.content = mergeViewportContent(original, VIEWPORT_ADDITIONS)
  }
  for (const [name, content] of APP_META) {
    if (doc.querySelector(`meta[name="${name}"]`) !== null) continue
    const tag = doc.createElement("meta")
    tag.name = name
    tag.content = content
    tag.dataset.plugin = OWNER
    doc.head.append(tag)
    added.push(tag)
  }
  const patched = viewport
  return () => {
    if (original !== undefined) patched.content = original
    for (const tag of added) tag.remove()
  }
}

/** The parts of `window.visualViewport` the measurement reads. */
export interface ViewportSize {
  readonly width: number
  readonly height: number
  readonly scale: number
}

export interface ViewportBaseline {
  readonly width: number
  readonly height: number
}

export interface ViewportMeasure {
  /** Height in CSS pixels the page should take. */
  readonly height: number
  /** Whether the on-screen keyboard (or another inset of that size) is up. */
  readonly keyboard: boolean
  readonly baseline: ViewportBaseline
}

/** A shrink larger than this is the keyboard; smaller ones are browser toolbars. */
export const KEYBOARD_THRESHOLD = 120

/**
 * Size the page from the visual viewport. The tallest height seen at the
 * current width is the keyboard-free baseline; a rotation resets it. While the
 * page is pinch-zoomed the visual viewport says nothing about the keyboard, so
 * the layout height is kept.
 */
export function measureViewport(
  viewport: ViewportSize,
  baseline: ViewportBaseline | undefined,
  innerHeight: number,
): ViewportMeasure {
  if (Math.abs(viewport.scale - 1) > 0.01) {
    return {
      height: innerHeight,
      keyboard: false,
      baseline: baseline ?? { width: viewport.width, height: innerHeight },
    }
  }
  const next: ViewportBaseline =
    baseline === undefined || Math.abs(baseline.width - viewport.width) > 1
      ? { width: viewport.width, height: Math.max(viewport.height, innerHeight) }
      : { width: baseline.width, height: Math.max(baseline.height, viewport.height) }
  return {
    height: viewport.height,
    keyboard: next.height - viewport.height > KEYBOARD_THRESHOLD,
    baseline: next,
  }
}

interface VisualViewportLike extends ViewportSize {
  addEventListener(type: "resize" | "scroll", listener: () => void): void
  removeEventListener(type: "resize" | "scroll", listener: () => void): void
}

export interface ViewportWindow {
  readonly visualViewport?: VisualViewportLike | null
  readonly innerHeight: number
  readonly scrollY: number
  scrollTo(x: number, y: number): void
  requestAnimationFrame(callback: () => void): number
  cancelAnimationFrame(handle: number): void
}

export interface ViewportRoot {
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): void }
  toggleAttribute(name: string, force: boolean): boolean
  removeAttribute(name: string): void
}

export const HEIGHT_VARIABLE = "--dsh-mobile-vvh"
export const KEYBOARD_ATTRIBUTE = "data-dsh-keyboard"

/**
 * Publish the visible height as `--dsh-mobile-vvh` on the root element and mark
 * `data-dsh-keyboard` while the keyboard is up. iOS scrolls the whole document
 * to reveal a focused field; once the page fits the visible area that scroll
 * only hides the header, so it is undone.
 * @returns a disposer removing the listeners, the variable and the mark.
 */
export function trackViewport(win: ViewportWindow, root: ViewportRoot): () => void {
  const viewport = win.visualViewport
  if (viewport === undefined || viewport === null) return () => {}
  let baseline: ViewportBaseline | undefined
  let frame: number | undefined

  const update = () => {
    frame = undefined
    const measure = measureViewport(viewport, baseline, win.innerHeight)
    baseline = measure.baseline
    root.style.setProperty(HEIGHT_VARIABLE, `${Math.round(measure.height)}px`)
    root.toggleAttribute(KEYBOARD_ATTRIBUTE, measure.keyboard)
    if (measure.keyboard && win.scrollY !== 0) win.scrollTo(0, 0)
  }
  const schedule = () => {
    frame ??= win.requestAnimationFrame(update)
  }

  viewport.addEventListener("resize", schedule)
  viewport.addEventListener("scroll", schedule)
  update()
  return () => {
    viewport.removeEventListener("resize", schedule)
    viewport.removeEventListener("scroll", schedule)
    if (frame !== undefined) win.cancelAnimationFrame(frame)
    root.style.removeProperty(HEIGHT_VARIABLE)
    root.removeAttribute(KEYBOARD_ATTRIBUTE)
  }
}
