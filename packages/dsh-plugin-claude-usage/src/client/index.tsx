import { createUsageBridge } from "./bridge"
import { en, ja } from "./i18n"
import { USAGE_CSS } from "./styles"
import type { ClientContext } from "./types"
import { UsageBar } from "./UsageBar"

/** Cordis services required by the browser half. */
export const inject = ["slots", "locale", "remote"]

export const NAMESPACE = "claude-usage"

const PLUGIN_ID = "@1outres/dsh-plugin-claude-usage"
export const SLOT = "shell.bottom"

/**
 * Browser half: the Host's rate limit snapshot stream becomes a status bar at
 * the bottom of the frame, with the `/usage` report in a popover.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NAMESPACE, { en, ja }), "claude-usage: dictionaries")

  ctx.effect(() => {
    const tag = document.createElement("style")
    tag.dataset.plugin = PLUGIN_ID
    tag.dataset.pluginCss = `${PLUGIN_ID}/usage.css`
    tag.textContent = USAGE_CSS
    document.head.append(tag)
    return () => {
      tag.remove()
    }
  }, "claude-usage: stylesheet")

  const bridge = createUsageBridge(ctx)
  ctx.effect(() => () => bridge.dispose(), "claude-usage: Host stream")

  ctx.effect(
    () =>
      ctx.slots.inject(SLOT, () =>
        ctx.slots.register(
          {
            name: SLOT,
            locale: NAMESPACE,
            inject: () => ({ store: bridge.store, loadReport: bridge.loadReport }),
          },
          UsageBar,
        ),
      ),
    "claude-usage: bottom bar",
  )
}
