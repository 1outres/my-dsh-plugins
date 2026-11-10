import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { en, ja, zh } from "../src/client/i18n"
import { SettingsPage } from "../src/client/SettingsPage"
import { MOBILE_CSS } from "../src/client/styles"
import type {
  ConfigForm,
  InstallOutcome,
  MobileConfig,
  Observable,
  PageState,
  PwaState,
} from "../src/client/types"

const fixed = <T>(value: T): Observable<T> => ({
  getSnapshot: () => value,
  subscribe: () => () => {},
})

const t = (key: string) => key
const phone: PageState = { mobile: true, touch: true }
const browser: PwaState = {
  worker: "ready",
  standalone: false,
  installable: false,
  platform: "other",
}

function form(
  value: Partial<MobileConfig>,
  status: "ready" | "unavailable" = "ready",
  writable = true,
): ConfigForm<Partial<MobileConfig>> {
  return {
    getSnapshot: () => ({ status, value, writable }),
    subscribe: () => () => {},
    set: async () => true,
    unset: async () => true,
  }
}

function render(
  options: {
    pwa?: Partial<PwaState>
    install?: () => Promise<InstallOutcome>
    value?: Partial<MobileConfig>
  } = {},
) {
  return renderToStaticMarkup(
    createElement(SettingsPage, {
      form: form(options.value ?? {}),
      page: fixed(phone),
      pwa: fixed({ ...browser, ...options.pwa }),
      install: options.install ?? (async (): Promise<InstallOutcome> => "unavailable"),
      t,
    }),
  )
}

describe("settings page", () => {
  it("shows every setting with its current value", () => {
    const html = renderToStaticMarkup(
      createElement(SettingsPage, {
        form: form({ enterKey: "send", swipe: false }),
        page: fixed(phone),
        pwa: fixed(browser),
        install: async (): Promise<InstallOutcome> => "unavailable",
        t,
      }),
    )
    for (const key of [
      "settings.statusMobile",
      "settings.enterKey",
      "settings.swipe",
      "settings.fitKeyboard",
      "settings.blockPullToRefresh",
      "settings.autoFocusComposer",
      "settings.reset",
    ]) {
      expect(html).toContain(key)
    }
    expect(html).toMatch(/aria-pressed="true"[^>]*>settings\.enterKey\.send</)
    expect(html).toMatch(/aria-pressed="false"[^>]*>settings\.enterKey\.newline</)
    expect(html).toMatch(/role="switch" aria-checked="false" aria-label="settings\.swipe"/)
    expect(html).not.toContain("settings.breakpoint")
    expect(html).not.toContain("settings.mode")
  })

  it("says whether the Harness uses its phone layout", () => {
    const desk = renderToStaticMarkup(
      createElement(SettingsPage, {
        form: form({}),
        page: fixed({ mobile: false, touch: false } satisfies PageState),
        pwa: fixed(browser),
        install: async (): Promise<InstallOutcome> => "unavailable",
        t,
      }),
    )
    expect(desk).toContain("settings.statusDesktop")
  })

  it("shows the app status, the worker state and the PWA settings", () => {
    const html = render({ pwa: { worker: "off" } })
    expect(html).toContain("settings.app")
    expect(html).toContain("settings.appBrowser")
    expect(html).toContain("settings.workerStatus")
    expect(html).toContain("settings.worker.off")
    expect(html).toContain("settings.serviceWorker")
    expect(html).toContain("settings.themeColor")
    expect(html).toContain("settings.pushHint")
    expect(html).toMatch(/role="switch" aria-checked="true" aria-label="settings\.serviceWorker"/)
    expect(html).toMatch(/role="switch" aria-checked="true" aria-label="settings\.themeColor"/)
  })

  it("marks the installed app", () => {
    expect(render({ pwa: { standalone: true } })).toContain("settings.appInstalled")
  })

  it("offers the install button only when the browser captured a prompt", () => {
    expect(render({ pwa: { installable: true } })).toMatch(/>settings\.install<\/button>/)
    expect(render()).not.toMatch(/>settings\.install<\/button>/)
  })

  it("explains Add to Home Screen on iOS outside the installed app", () => {
    expect(render({ pwa: { platform: "ios" } })).toContain("settings.installHint")
    expect(render({ pwa: { platform: "ios", standalone: true } })).not.toContain(
      "settings.installHint",
    )
    expect(render()).not.toContain("settings.installHint")
  })

  it("disables the controls when a higher layer owns the entry", () => {
    const html = renderToStaticMarkup(
      createElement(SettingsPage, {
        form: form({}, "ready", false),
        page: fixed(phone),
        pwa: fixed(browser),
        install: async (): Promise<InstallOutcome> => "unavailable",
        t,
      }),
    )
    expect(html).toContain("settings.readOnly")
    expect(html).toContain("disabled")
  })

  it("explains an unavailable entry", () => {
    const html = renderToStaticMarkup(
      createElement(SettingsPage, {
        form: form({}, "unavailable"),
        page: fixed(phone),
        pwa: fixed(browser),
        install: async (): Promise<InstallOutcome> => "unavailable",
        t,
      }),
    )
    expect(html).toContain("settings.unavailable")
  })
})

describe("copy", () => {
  it("keeps the three dictionaries in step", () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
    expect(Object.keys(ja).sort()).toEqual(Object.keys(en).sort())
  })
})

describe("stylesheet", () => {
  it("leaves the Harness drawer and its opener alone", () => {
    expect(MOBILE_CSS).not.toContain("dsh-mobile-menu")
    expect(MOBILE_CSS).not.toContain("dsh-mobile-scrim")
    expect(MOBILE_CSS).not.toContain("dsh-mobile-floating")
    expect(MOBILE_CSS).not.toContain("[data-sidebar-opener]")
    expect(MOBILE_CSS).not.toContain("grid-template-columns")
  })

  it("fits the page to the keyboard and respects the safe areas", () => {
    expect(MOBILE_CSS).toContain("--dsh-mobile-vvh")
    expect(MOBILE_CSS).toContain("safe-area-inset-bottom")
    expect(MOBILE_CSS).toContain("[data-dsh-keyboard] [data-composer-seat]")
    expect(MOBILE_CSS).toContain('[data-shortcut-modal="settings"]')
  })

  it("scopes every host rule under the plugin's root attributes", () => {
    const rules = MOBILE_CSS.split("}")
      .map((rule) => rule.split("{")[0]?.trim() ?? "")
      .filter(
        (selector) => selector.length > 0 && !selector.startsWith("@") && !selector.startsWith("."),
      )
    for (const selector of rules) {
      for (const part of selector.split(/,(?![^(]*\))/)) {
        expect(part.trim()).toMatch(/^(html\[data-dsh-|\.dsh-mobile)/)
      }
    }
  })
})
