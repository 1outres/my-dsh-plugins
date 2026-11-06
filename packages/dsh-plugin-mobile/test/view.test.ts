import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { DrawerOverlay, HeaderMenuButton, mainSessionOf } from "../src/client/components"
import { MOBILE_CSS } from "../src/client/styles"
import type {
  ModeState,
  Observable,
  PanelInfo,
  SessionsState,
  UsePanelInfo,
  UseSessions,
} from "../src/client/types"

const fixed = <T>(value: T): Observable<T> => ({
  getSnapshot: () => value,
  subscribe: () => () => {},
})

const t = (key: string) => key
const toggle = () => {}
const phone: ModeState = { mobile: true, touch: true }
const desktop: ModeState = { mobile: false, touch: false }

let shownPanel: string | null = null
const noSessions: SessionsState = { byId: {} }
const usePanelInfo: UsePanelInfo = (selector) =>
  selector({ activePanelId: shownPanel } satisfies PanelInfo)
const useSessions: UseSessions = (selector) => selector(noSessions)

function hooks(panel: string | null) {
  shownPanel = panel
  return { usePanelInfo, useSessions }
}

describe("header menu button", () => {
  it("is hidden outside the phone layout", () => {
    const html = renderToStaticMarkup(
      createElement(HeaderMenuButton, { mode: fixed(desktop), toggle, t }),
    )
    expect(html).toContain('hidden=""')
  })

  it("shows a labelled button in the phone layout", () => {
    const html = renderToStaticMarkup(
      createElement(HeaderMenuButton, { mode: fixed(phone), toggle, t }),
    )
    expect(html).not.toContain('hidden=""')
    expect(html).toContain('aria-label="menu.open"')
    expect(html).toContain("<svg")
  })
})

describe("drawer overlay", () => {
  it("renders only its anchor outside the phone layout", () => {
    const html = renderToStaticMarkup(
      createElement(DrawerOverlay, { mode: fixed(desktop), toggle, t, ...hooks(null) }),
    )
    expect(html).toBe('<span hidden=""></span>')
  })

  it("keeps a closed scrim over the Conversation", () => {
    const html = renderToStaticMarkup(
      createElement(DrawerOverlay, { mode: fixed(phone), toggle, t, ...hooks(null) }),
    )
    expect(html).toContain('class="dsh-mobile-scrim"')
    expect(html).not.toContain("data-open")
    expect(html).not.toContain("dsh-mobile-floating")
  })

  it("adds a floating menu button over a global panel", () => {
    const html = renderToStaticMarkup(
      createElement(DrawerOverlay, { mode: fixed(phone), toggle, t, ...hooks("plugins") }),
    )
    expect(html).toContain("dsh-mobile-floating")
  })
})

describe("helpers", () => {
  it("finds the Session the main column shows", () => {
    expect(
      mainSessionOf({
        byId: { a: { retainedBy: { mainView: 0 } }, b: { retainedBy: { mainView: 1 } } },
      }),
    ).toBe("b")
    expect(mainSessionOf({ byId: { a: {} } })).toBeUndefined()
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
