import type { Context } from "@deepseek-ai/cordis"
import z from "@deepseek-ai/schemastery"

export const name = "mobile"

/**
 * Settings. Every field is volatile: the browser half reads them through
 * `configForms` and applies a change at once, without restarting this half.
 */
export const Config = z.object({
  mode: z
    .union(["auto", "always", "off"])
    .default("auto")
    .description(
      "When to use the phone layout: auto below the breakpoint width, always, or never (off).",
    )
    .volatile(),
  breakpoint: z
    .natural()
    .min(360)
    .max(1024)
    .default(768)
    .description("Viewport width in CSS pixels below which auto mode uses the phone layout.")
    .volatile(),
  enterKey: z
    .union(["newline", "send"])
    .default("newline")
    .description(
      "What Enter does in the composer on a touch screen in the phone layout: add a line (send with the button) or send.",
    )
    .volatile(),
  swipe: z
    .boolean()
    .default(true)
    .description("Open the sidebar by swiping right from the left edge, close it by swiping left.")
    .volatile(),
  fitKeyboard: z
    .boolean()
    .default(true)
    .description(
      "Fit the page to the area the on-screen keyboard leaves visible, so the header and the composer stay on screen.",
    )
    .volatile(),
  blockPullToRefresh: z
    .boolean()
    .default(true)
    .description("Stop pull-to-refresh and overscroll bounce from reloading or moving the page.")
    .volatile(),
  autoFocusComposer: z
    .boolean()
    .default(false)
    .description(
      "Let the composer take focus by itself on a touch screen in the phone layout, as on desktop: when a session opens or a composer button is pressed. Off keeps the on-screen keyboard closed until you tap the input.",
    )
    .volatile(),
})

interface SettingsLike {
  configure(presentation: { auto?: boolean }, owner?: unknown): () => void
}

/**
 * Host half. It owns no runtime behavior: the layout belongs to the browser
 * looking at the page. This half declares the settings and tells Settings that
 * the plugin ships its own page instead of the schema-generated one.
 */
export function apply(ctx: Context): void {
  ctx.inject(["settings"], (child) => {
    const settings = (child as Context & { settings: SettingsLike }).settings
    child.effect(
      () => settings.configure({ auto: false }, ctx.fiber),
      "mobile: settings page policy",
    )
  })
}
