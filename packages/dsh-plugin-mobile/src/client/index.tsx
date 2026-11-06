import { NAMESPACE, normalizeConfig } from "./config"
import { createDrawerSource, observeMutations } from "./drawer"
import { installEnterNewline } from "./enter"
import { installFocusGuard } from "./focus"
import { findFrame, isExpanded, swipeBlocked } from "./frame"
import { en, ja, zh } from "./i18n"
import { createPageStore, mediaSource, TOUCH_QUERY } from "./page"
import { SettingsPage } from "./SettingsPage"
import { MOBILE_ATTRIBUTE, MOBILE_CSS, NO_PULL_ATTRIBUTE, TOUCH_ATTRIBUTE } from "./styles"
import { installSwipe } from "./swipe"
import type { ClientContext, MobileConfig } from "./types"
import { installMeta, trackViewport } from "./viewport"

/** Cordis services required by the browser half. */
export const inject = ["slots", "locale", "configForms", "layout"]

const PLUGIN_ID = "@1outres/dsh-plugin-mobile"

/** One page of the Settings dialog. */
export const SETTINGS_SLOT = "settings.section"

/**
 * Browser half. It follows the Harness phone layout, fits the page to the
 * on-screen keyboard, keeps the on-screen keyboard closed until the composer
 * is tapped, lets Enter add a line, and adds edge swipes to the Harness
 * navigation drawer. Everything is undone on teardown.
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
  const page = createPageStore({
    drawer: createDrawerSource(document, observeMutations),
    touch: mediaSource((query) => window.matchMedia(query), TOUCH_QUERY),
  })
  ctx.effect(() => () => page.dispose(), "mobile: page state")

  ctx.effect(() => {
    const root = document.documentElement
    let stopViewport: (() => void) | undefined
    const sync = () => {
      const state = page.getSnapshot()
      root.toggleAttribute(MOBILE_ATTRIBUTE, state.mobile)
      root.toggleAttribute(TOUCH_ATTRIBUTE, state.touch)
      root.toggleAttribute(NO_PULL_ATTRIBUTE, state.mobile && config.blockPullToRefresh)
      const fit = state.mobile && config.fitKeyboard
      if (fit && stopViewport === undefined) {
        stopViewport = trackViewport(window, root)
      } else if (!fit && stopViewport !== undefined) {
        stopViewport()
        stopViewport = undefined
      }
    }
    const offPage = page.subscribe(sync)
    const offForm = form.subscribe(() => {
      config = normalizeConfig(form.getSnapshot().value)
      sync()
    })
    sync()
    return () => {
      offPage()
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

  ctx.effect(
    () =>
      installEnterNewline(window, () => {
        const state = page.getSnapshot()
        return state.mobile && state.touch && config.enterKey === "newline"
      }),
    "mobile: Enter adds a line",
  )

  ctx.effect(
    () =>
      installFocusGuard(document, () => {
        const state = page.getSnapshot()
        return state.mobile && state.touch && !config.autoFocusComposer
      }),
    "mobile: keyboard stays closed until the composer is tapped",
  )

  ctx.effect(
    () =>
      installSwipe(document, {
        enabled: () => page.getSnapshot().mobile && config.swipe,
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

  // biome-ignore lint/correctness/noComponentHookFactories: the page closes over the shared form, page and translator
  const Page = () => <SettingsPage form={form} page={page} t={t} />

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
