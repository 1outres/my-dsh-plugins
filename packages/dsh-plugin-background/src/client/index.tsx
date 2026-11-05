import { CONFIG_NAMESPACE, normalizeConfig, TOKEN_NAMES } from "./config"
import { alphaColor, clamp, dimColor, imageCssValue, resolveImageSource } from "./format"
import { en } from "./i18n"
import { SettingsPage } from "./SettingsPage"
import { BACKGROUND_CSS } from "./styles"
import type { BackgroundConfig, ClientContext, ThemeSnapshot } from "./types"

/** Cordis services required by the browser half. */
export const inject = ["slots", "locale", "configForms", "theme"]

const PLUGIN_ID = "@1outres/dsh-plugin-background"
const ATTRIBUTE = "data-dsh-background"
const OVERLAY_TOKEN = "--dsw-alias-bg-overlay"

/** Browser half: keep the global layer in sync with the Host settings entry. */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(CONFIG_NAMESPACE)

  ctx.effect(() => ctx.locale.register(CONFIG_NAMESPACE, { en }), "background: dictionaries")

  ctx.effect(() => {
    const tag = document.createElement("style")
    tag.dataset.plugin = PLUGIN_ID
    tag.dataset.pluginCss = `${PLUGIN_ID}/background.css`
    tag.textContent = BACKGROUND_CSS
    document.head.append(tag)
    return () => tag.remove()
  }, "background: stylesheet")

  const form = ctx.configForms.get<BackgroundConfig>(CONFIG_NAMESPACE)
  let tokenDispose: (() => void) | undefined
  let activeConfig: BackgroundConfig | undefined
  let applying = false
  let signature = ""

  const themeSignature = (snapshot: ThemeSnapshot) =>
    `${snapshot.active.id}:${snapshot.active.colorScheme}`

  /**
   * The base palette is defined by stylesheet rules on `body`, so read the
   * computed alias color after releasing our own override. Values are wrapped
   * in `color-mix` so the theme-owned hue survives.
   */
  const readBaseColor = (name: string): string | undefined => {
    const value = getComputedStyle(document.body).getPropertyValue(name).trim()
    return value.length > 0 ? value : undefined
  }

  const applyTokens = (config: BackgroundConfig) => {
    tokenDispose?.()
    tokenDispose = undefined
    const tokens: Record<string, { light: string; dark: string }> = {}
    for (const name of TOKEN_NAMES) {
      const base = readBaseColor(name)
      if (base === undefined) continue
      const percent =
        name === OVERLAY_TOKEN ? Math.min(100, config.panelOpacity + 20) : config.panelOpacity
      const value = alphaColor(base, percent)
      tokens[name] = { light: value, dark: value }
    }
    if (Object.keys(tokens).length > 0) tokenDispose = ctx.theme.overrideTokens(PLUGIN_ID, tokens)
  }

  const deactivate = () => {
    activeConfig = undefined
    tokenDispose?.()
    tokenDispose = undefined
    const root = document.documentElement
    root.removeAttribute(ATTRIBUTE)
    root.style.removeProperty("--dsh-background-image")
    root.style.removeProperty("--dsh-background-blur")
    root.style.removeProperty("--dsh-background-dim")
  }

  const applyConfig = (config: BackgroundConfig) => {
    if (applying) return
    applying = true
    try {
      activeConfig = config
      signature = themeSignature(ctx.theme.getTheme())
      const source = config.enabled ? resolveImageSource(config.image, document.baseURI) : undefined
      if (source === undefined) {
        deactivate()
        return
      }
      const root = document.documentElement
      root.setAttribute(ATTRIBUTE, "on")
      root.style.setProperty("--dsh-background-image", imageCssValue(source))
      root.style.setProperty("--dsh-background-blur", `${clamp(config.blur, 0, 40)}px`)
      root.style.setProperty("--dsh-background-dim", dimColor(config.dim))
      applyTokens(config)
    } finally {
      applying = false
    }
  }

  const sync = () => applyConfig(normalizeConfig(form.getSnapshot().value))

  ctx.effect(() => {
    const off = form.subscribe(sync)
    sync()
    return () => {
      off()
      deactivate()
    }
  }, "background: configuration")

  ctx.on("theme/change", (snapshot) => {
    if (applying) return
    if (themeSignature(snapshot) === signature) return
    signature = themeSignature(snapshot)
    if (activeConfig !== undefined) applyConfig(activeConfig)
  })

  // biome-ignore lint/correctness/noComponentHookFactories: the page closes over the shared form and translator
  const Page = () => <SettingsPage form={form} t={t} />

  ctx.effect(
    () =>
      ctx.configForms.whileServed([CONFIG_NAMESPACE], () =>
        ctx.slots.inject("settings.section", () =>
          ctx.slots.register(
            {
              name: "settings.section",
              id: "background",
              order: 60,
              label: () => t("nav"),
              locale: CONFIG_NAMESPACE,
            },
            Page,
          ),
        ),
      ),
    "background: settings section",
  )
}
