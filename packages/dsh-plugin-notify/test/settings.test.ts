import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { DEFAULT_CONFIG } from "../src/client/config"
import type { PushController, PushState } from "../src/client/push"
import { type Notifier, SettingsPage } from "../src/client/SettingsPage"
import type { ConfigForm, NotifyConfig } from "../src/client/types"

type Permission = ReturnType<Notifier["permission"]>

function form(): ConfigForm<NotifyConfig> {
  return {
    getSnapshot: () => ({ status: "ready", value: DEFAULT_CONFIG, revision: 1, writable: true }),
    subscribe: () => () => {},
    set: async () => true,
    unset: async () => true,
  }
}

function notifier(permission: Permission): Notifier {
  return {
    permission: () => permission,
    request: async () => permission,
    test: async () => false,
  }
}

function push(state: PushState): PushController {
  return {
    state: { getSnapshot: () => state, subscribe: () => () => {} },
    start: () => () => {},
    refresh: async () => {},
    enable: async () => {},
    disable: async () => {},
    test: async () => "failed",
  }
}

function render(state: PushState, permission: Permission): string {
  return renderToStaticMarkup(
    createElement(SettingsPage, {
      form: form(),
      t: (key: string) => key,
      notifier: notifier(permission),
      push: push(state),
    }),
  )
}

function button(html: string, label: string): string {
  const match = html.match(new RegExp(`<button[^>]*>${label}</button>`))
  if (match === null) throw new Error(`missing the ${label} button`)
  return match[0]
}

describe("SettingsPage", () => {
  it("explains the Home Screen step instead of claiming an unsupported browser", () => {
    const html = render("needs-install", "unsupported")

    expect(html).toContain("permissionNeedsInstall")
    expect(html).not.toContain("permissionUnsupported")
    expect(button(html, "test")).toContain("disabled")
  })

  it("disables the permission buttons while the app needs an install", () => {
    const html = render("needs-install", "default")

    expect(button(html, "allow")).toContain("disabled")
    expect(button(html, "test")).toContain("disabled")
  })

  it("keeps the unsupported message outside a Home Screen case", () => {
    const html = render("unsupported", "unsupported")

    expect(html).toContain("permissionUnsupported")
    expect(html).not.toContain("permissionNeedsInstall")
  })
})
