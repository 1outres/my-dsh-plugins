import { type DrawerFace, DrawerOverlay, HeaderMenuButton } from "./components"
import { NAMESPACE, normalizeConfig } from "./config"
import { installEnterNewline } from "./enter"
import { findFrame, isExpanded, swipeBlocked } from "./frame"
import { en, ja, zh } from "./i18n"
import { createModeStore } from "./mode"
import { SettingsPage } from "./SettingsPage"
import { MOBILE_ATTRIBUTE, MOBILE_CSS, NO_PULL_ATTRIBUTE, TOUCH_ATTRIBUTE } from "./styles"
import { installSwipe } from "./swipe"
import type { ClientContext, MobileConfig } from "./types"
import { installMeta, trackViewport } from "./viewport"

/** Cordis services required by the browser half. */
export const inject = ["slots", "locale", "configForms", "layout"]

const PLUGIN_ID = "@1outres/dsh-plugin-mobile"

/** Global navigation before the Session title; empty in the shipped composition. */
export const HEADER_SLOT = "conversation.header.leading"
/** Frame-wide floating layer, above every column. */
export const OVERLAY_SLOT = "shell.overlay"
/** One page of the Settings dialog. */
export const SETTINGS_SLOT = "settings.section"

/**
 * Browser half. Below the breakpoint it marks the root element so the
 * stylesheet turns the sidebar into a drawer and fits the page to phones, adds
 * the drawer's menu button and scrim through slots, and wires the keyboard,
 * Enter and swipe behavior. Everything is undone on teardown.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NAMESPACE, { en, zh, ja }), "mobile: dictionaries")
  const t = ctx.locale.bind(NAMESPACE)

  ctx.effect(() => {
    const tag = document.createElement("style")
    tag.dataset.plugin = PLUGIN_ID
    tag.dataset.pluginCss = `${PLUGIN_ID}/mobile.css`
    tag.textContent = MOBILE_CSS
    document.head.append(tag)
    return () => {
      tag.remove()
    }
  }, "mobile: stylesheet")

  ctx.effect(() => installMeta(document), "mobile: viewport metadata")

  const form = ctx.configForms.get<Partial<MobileConfig>>(NAMESPACE)
  let config = normalizeConfig(form.getSnapshot().value)
  const mode = createModeStore(
    (query) => window.matchMedia(query),
    () => config,
  )
  ctx.effect(() => () => mode.dispose(), "mobile: layout mode")

  ctx.effect(() => {
    const root = document.documentElement
    let stopViewport: (() => void) | undefined
    const sync = () => {
      const state = mode.getSnapshot()
      root.toggleAttribute(MOBILE_ATTRIBUTE, state.mobile)
      root.toggleAttribute(TOUCH_ATTRIBUTE, state.touch && config.mode !== "off")
      root.toggleAttribute(NO_PULL_ATTRIBUTE, state.mobile && config.blockPullToRefresh)
      const fit = state.mobile && config.fitKeyboard
      if (fit && stopViewport === undefined) {
        stopViewport = trackViewport(window, root)
      } else if (!fit && stopViewport !== undefined) {
        stopViewport()
        stopViewport = undefined
      }
    }
    const offMode = mode.subscribe(sync)
    const offForm = form.subscribe(() => {
      config = normalizeConfig(form.getSnapshot().value)
      mode.refresh()
      sync()
    })
    sync()
    return () => {
      offMode()
      offForm()
      stopViewport?.()
      root.removeAttribute(MOBILE_ATTRIBUTE)
      root.removeAttribute(TOUCH_ATTRIBUTE)
      root.removeAttribute(NO_PULL_ATTRIBUTE)
    }
  }, "mobile: page layout")

  const toggle = () => {
    try {
      ctx.layout.toggleSidebar()
    } catch (error) {
      console.warn("mobile: could not toggle the sidebar", error)
    }
  }
  const face: DrawerFace = { mode, toggle }

  ctx.effect(
    () =>
      installEnterNewline(window, () => {
        const state = mode.getSnapshot()
        return state.mobile && state.touch && config.enterKey === "newline"
      }),
    "mobile: Enter adds a line",
  )

  ctx.effect(
    () =>
      installSwipe(document, {
        enabled: () => mode.getSnapshot().mobile && config.swipe,
        expanded: () => isExpanded(findFrame(document)),
        blocked: (target) =>
          swipeBlocked(
            target,
            document,
            (element) => getComputedStyle(element as unknown as Element).overflowX,
          ),
        toggle,
      }),
    "mobile: drawer swipe",
  )

  ctx.effect(
    () =>
      ctx.slots.inject(HEADER_SLOT, () =>
        ctx.slots.register(
          { name: HEADER_SLOT, locale: NAMESPACE, inject: () => face },
          HeaderMenuButton,
        ),
      ),
    "mobile: header menu button",
  )

  ctx.effect(
    () =>
      ctx.slots.inject(OVERLAY_SLOT, () =>
        ctx.slots.register(
          { name: OVERLAY_SLOT, id: "mobile-drawer", locale: NAMESPACE, inject: () => face },
          DrawerOverlay,
        ),
      ),
    "mobile: drawer scrim",
  )

  // biome-ignore lint/correctness/noComponentHookFactories: the page closes over the shared form, mode and translator
  const Page = () => <SettingsPage form={form} mode={mode} t={t} />

  ctx.effect(
    () =>
      ctx.configForms.whileServed([NAMESPACE], () =>
        ctx.slots.inject(SETTINGS_SLOT, () =>
          ctx.slots.register(
            {
              name: SETTINGS_SLOT,
              id: "mobile",
              order: 62,
              label: () => t("nav"),
              locale: NAMESPACE,
            },
            Page,
          ),
        ),
      ),
    "mobile: settings section",
  )
}
