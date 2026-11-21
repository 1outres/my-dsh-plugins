import { resolveRoot } from "../shared/paths"
import { type OpenTodayFace, OpenTodayFooterButton } from "./components"
import { en, ja } from "./i18n"
import { TODAY_CSS } from "./styles"
import { createTodayOpener } from "./today"
import type { ClientContext, DailyWorkspaceConfig } from "./types"

/** Cordis services required by the browser half. */
export const inject = ["slots", "locale", "configForms", "workspaces", "uiWorkspace", "remote"]

const PLUGIN_ID = "@1outres/dsh-plugin-daily-workspace"

/** Locale namespace, and the settings entry id the Host half reads. */
export const NAMESPACE = "daily-workspace"

export const FOOTER_SLOT = "sidebar.footer.action"
export const FOOTER_ID = "daily-workspace"
/** After the scratchpad row (default order) and before the claude-usage row (10). */
export const FOOTER_ORDER = 5

/**
 * Browser half: an "Open today" button at the sidebar foot. The Host half
 * registers today's folder; the button opens the newest registered day folder
 * under the configured root.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NAMESPACE, { en, ja }), "daily-workspace: dictionaries")

  ctx.effect(() => {
    const tag = document.createElement("style")
    tag.dataset.plugin = PLUGIN_ID
    tag.dataset.pluginCss = `${PLUGIN_ID}/today.css`
    tag.textContent = TODAY_CSS
    document.head.append(tag)
    return () => {
      tag.remove()
    }
  }, "daily-workspace: stylesheet")

  const t = ctx.locale.bind(NAMESPACE)
  const settings = ctx.configForms.get<DailyWorkspaceConfig>(NAMESPACE)
  ctx.effect(() => settings.subscribe(() => {}), "daily-workspace: settings")
  const root = () => resolveRoot(settings.getSnapshot().value?.root, ctx.remote.$host.home)

  const opener = createTodayOpener(
    {
      root,
      workspaces: () => ctx.workspaces.list.getSnapshot(),
      openWorkspace: (workspaceId) => ctx.uiWorkspace.openWorkspace(workspaceId),
    },
    { t, warn: (message, error) => console.warn(message, error) },
  )
  ctx.effect(() => () => opener.dispose(), "daily-workspace: opener")
  const face: OpenTodayFace = { open: () => opener.open(), status: opener.status }

  ctx.effect(
    () =>
      ctx.slots.inject(FOOTER_SLOT, () =>
        ctx.slots.register(
          {
            name: FOOTER_SLOT,
            id: FOOTER_ID,
            order: FOOTER_ORDER,
            locale: NAMESPACE,
            inject: () => face,
          },
          OpenTodayFooterButton,
        ),
      ),
    "daily-workspace: sidebar button",
  )
}
