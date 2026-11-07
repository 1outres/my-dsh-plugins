import { createPromptBridge } from "./bridge"
import { en, ja, zh } from "./i18n"
import { REMOTE_TOOL_NAMES, RemoteToolView } from "./RemoteToolView"
import { REMOTE_CSS } from "./styles"
import type { ClientContext, ToolCallProps } from "./types"

/** Cordis services required by the browser half. */
export const inject = ["slots", "locale", "remote"]

const NAMESPACE = "remote"
const PLUGIN_ID = "@1outres/dsh-plugin-remote"

/**
 * Browser half: the password and approval cards, the card stream from the
 * Host, and one tool view for each remote_* tool.
 */
export async function apply(ctx: ClientContext): Promise<void> {
  ctx.effect(() => ctx.locale.register(NAMESPACE, { en, ja, zh }), "remote: dictionaries")
  const t = ctx.locale.bind(NAMESPACE)

  ctx.effect(() => {
    const root = document.documentElement
    root.setAttribute("data-remote-plugin", "")
    const style = document.createElement("style")
    style.dataset.plugin = PLUGIN_ID
    style.dataset.pluginCss = `${PLUGIN_ID}/remote.css`
    style.textContent = REMOTE_CSS
    document.head.append(style)
    return () => {
      style.remove()
      root.removeAttribute("data-remote-plugin")
    }
  }, "remote: styles")

  const bridge = await createPromptBridge(ctx)
  ctx.effect(() => () => bridge.dispose(), "remote: card bridge")

  const view = (props: ToolCallProps): React.JSX.Element => (
    <RemoteToolView {...props} bridge={bridge} t={t} />
  )
  ctx.effect(
    () =>
      ctx.slots.inject("tool.call.toolview", () => {
        const disposers = REMOTE_TOOL_NAMES.map((key) =>
          ctx.slots.register({ name: "tool.call.toolview", key, locale: NAMESPACE }, view),
        )
        return () => {
          for (const dispose of disposers) dispose()
        }
      }),
    "remote: tool cards",
  )
}
