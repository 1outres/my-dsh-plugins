import { readFileSync } from "node:fs"
import type { Context } from "@deepseek-ai/cordis"
import z from "@deepseek-ai/schemastery"
import { createWorkerRoute, type WebServerLike } from "./host/worker-route"

export const name = "mobile"

/**
 * Settings. Every field is volatile: the browser half reads them through
 * `configForms` and applies a change at once, without restarting this half.
 */
export const Config = z.object({
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
    .description(
      "Open the Harness navigation drawer by swiping right from the left edge, close it by swiping left.",
    )
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
      "Let the Harness focus the composer on a touch screen in the phone layout, as on desktop, when a composer control or another action moves focus to it. Off keeps the on-screen keyboard closed until you tap the input.",
    )
    .volatile(),
  serviceWorker: z
    .boolean()
    .default(true)
    .description(
      "Register the app's service worker: it shows an offline page when the Host cannot be reached and delivers push notifications (used by the notify plugin). Off unregisters it.",
    )
    .volatile(),
  themeColor: z
    .boolean()
    .default(true)
    .description(
      "Paint the browser and installed-app title bar in the page background color, following the light or dark theme.",
    )
    .volatile(),
})

interface SettingsLike {
  configure(presentation: { auto?: boolean }, owner?: unknown): () => void
}

/**
 * Host half. It declares the settings, tells Settings that the plugin ships its
 * own page instead of the schema-generated one, and serves the service worker
 * script. It owns no runtime behavior: the layout belongs to the browser
 * looking at the page.
 */
export function apply(ctx: Context): void {
  ctx.inject(["settings"], (child) => {
    const settings = (child as Context & { settings: SettingsLike }).settings
    child.effect(
      () => settings.configure({ auto: false }, ctx.fiber),
      "mobile: settings page policy",
    )
  })

  ctx.inject(["webServer"], (child) => {
    const webServer = (child as Context & { webServer: WebServerLike }).webServer
    child.effect(
      () =>
        webServer.register(createWorkerRoute(readFileSync(new URL("./sw.js", import.meta.url)))),
      "mobile: service worker route",
    )
  })
}
