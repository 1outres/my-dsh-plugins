import type { MediaQueryLike } from "../page"
import type { BooleanSetting } from "../types"

/** Media query that changes with the light or dark color scheme. */
export const THEME_QUERY = "(prefers-color-scheme: dark)"
export const THEME_META = 'meta[name="theme-color"]'

const OWNER = "@1outres/dsh-plugin-mobile"

/** The slice of `HTMLMetaElement` the plugin uses. */
export interface MetaElement {
  name: string
  content: string
  readonly dataset: Record<string, string | undefined>
  remove(): void
}

/** The slice of `document` the theme color uses. */
export interface ThemeDocument {
  readonly documentElement: Node
  readonly body: Node
  readonly head: { append(node: unknown): void }
  querySelector(selector: string): MetaElement | null
  createElement(tag: "meta"): MetaElement
}

/** The slice of `window` the theme color uses. */
export interface ThemeWindow {
  matchMedia(query: string): MediaQueryLike
  getComputedStyle(element: Node): { readonly backgroundColor: string }
  requestAnimationFrame(callback: () => void): number
  cancelAnimationFrame(handle: number): void
}

export interface AttributeObserver {
  disconnect(): void
}

export type ObserveAttributes = (target: Node, callback: () => void) => AttributeObserver

/** Watch attribute changes on one element. */
export function observeAttributes(target: Node, callback: () => void): AttributeObserver {
  const observer = new MutationObserver(callback)
  observer.observe(target, { attributes: true })
  return observer
}

/**
 * Keep a `theme-color` meta tag in sync with the page background color.
 * The page changes its theme by attributes on `<html>` and `<body>`, and a
 * frame throttles the bursts those changes cause.
 * @returns a disposer restoring or removing the tag and its listeners.
 */
export function installTheme(
  doc: ThemeDocument,
  win: ThemeWindow,
  setting: BooleanSetting,
  observe: ObserveAttributes = observeAttributes,
): () => void {
  let active = false
  let tag: MetaElement | null = null
  let created = false
  let original: string | undefined
  let frame: number | undefined
  let observers: AttributeObserver[] = []
  let media: MediaQueryLike | undefined

  const update = () => {
    frame = undefined
    if (!active || tag === null) return
    tag.content = win.getComputedStyle(doc.body).backgroundColor
  }

  const schedule = () => {
    if (frame === undefined) frame = win.requestAnimationFrame(update)
  }

  const attach = () => {
    if (active) return
    active = true
    const found = doc.querySelector(THEME_META)
    if (found === null) {
      const createdTag = doc.createElement("meta")
      createdTag.name = "theme-color"
      createdTag.content = ""
      createdTag.dataset.plugin = OWNER
      doc.head.append(createdTag)
      tag = createdTag
      created = true
    } else {
      original = found.content
      tag = found
      created = false
    }
    media = win.matchMedia(THEME_QUERY)
    media.addEventListener("change", schedule)
    observers = [observe(doc.documentElement, schedule), observe(doc.body, schedule)]
    update()
  }

  const detach = () => {
    if (!active) return
    active = false
    for (const observer of observers) observer.disconnect()
    observers = []
    media?.removeEventListener("change", schedule)
    media = undefined
    if (frame !== undefined) {
      win.cancelAnimationFrame(frame)
      frame = undefined
    }
    if (tag !== null) {
      if (created) tag.remove()
      else if (original !== undefined) tag.content = original
    }
    tag = null
    original = undefined
    created = false
  }

  const applySetting = () => {
    if (setting.get()) attach()
    else detach()
  }

  const off = setting.subscribe(applySetting)
  applySetting()

  return () => {
    off()
    detach()
  }
}
