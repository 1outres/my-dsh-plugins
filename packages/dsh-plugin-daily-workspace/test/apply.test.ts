import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OpenTodayFooterButton } from "../src/client/components"
import { apply, FOOTER_ID, FOOTER_ORDER, FOOTER_SLOT, inject, NAMESPACE } from "../src/client/index"
import type { ClientContext, Observable, WorkspaceView } from "../src/client/types"

interface StyleTag {
  dataset: Record<string, string>
  textContent: string
  removed: boolean
  remove(): void
}

let styleTags: StyleTag[] = []

beforeEach(() => {
  styleTags = []
  vi.stubGlobal("document", {
    createElement: () => {
      const tag: StyleTag = {
        dataset: {},
        textContent: "",
        removed: false,
        remove() {
          tag.removed = true
        },
      }
      return tag
    },
    head: {
      append: (tag: StyleTag) => {
        styleTags.push(tag)
      },
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const fixed = <T>(value: T): Observable<T> => ({
  getSnapshot: () => value,
  subscribe: () => () => {},
})

function workspace(workspaceId: string, path: string): WorkspaceView {
  return {
    workspaceId,
    path,
    title: path.slice(path.lastIndexOf("/") + 1),
    sessionIds: [],
    createdAt: "2026-11-20T00:00:00Z",
  }
}

const ITEMS: WorkspaceView[] = [
  workspace("ws-year", "/home/me/Documents/2026"),
  workspace("ws-month", "/home/me/Documents/2026/11"),
  workspace("ws-day", "/home/me/Documents/2026/11/20"),
  workspace("ws-project", "/home/me/project"),
]

function createHarness(options: { home?: string; root?: string; items?: WorkspaceView[] } = {}) {
  const effects: (() => void)[] = []
  const registrations: { options: Record<string, unknown>; component: unknown }[] = []
  const locales: string[] = []
  const openWorkspace = vi.fn(async () => {})
  const configNamespaces: string[] = []
  let configSubscribers = 0
  let configDisposals = 0

  const effect = (run: () => (() => void) | undefined) => {
    const dispose = run()
    if (typeof dispose === "function") effects.push(dispose)
  }
  const ctx = {
    effect,
    slots: {
      inject: (_key: string, register: () => () => void) => register(),
      register: (registration: Record<string, unknown>, component: unknown) => {
        const entry = { options: registration, component }
        registrations.push(entry)
        return () => {
          registrations.splice(registrations.indexOf(entry), 1)
        }
      },
    },
    locale: {
      register: (namespace: string) => {
        locales.push(namespace)
        return () => {
          locales.splice(locales.indexOf(namespace), 1)
        }
      },
      bind: () => (key: string) => key,
    },
    configForms: {
      get: (namespace: string) => {
        configNamespaces.push(namespace)
        return {
          getSnapshot: () => ({ status: "ready", value: { root: options.root ?? "~/Documents" } }),
          subscribe: () => {
            configSubscribers += 1
            return () => {
              configSubscribers -= 1
              configDisposals += 1
            }
          },
        }
      },
    },
    workspaces: {
      list: fixed({ items: options.items ?? ITEMS, archivedSessionIds: [] }),
    },
    uiWorkspace: { openWorkspace },
    remote: { $host: { home: "home" in options ? options.home : "/home/me" } },
  }
  return {
    ctx: ctx as unknown as ClientContext,
    registrations,
    locales,
    openWorkspace,
    configNamespaces,
    get configSubscribers() {
      return configSubscribers
    },
    get configDisposals() {
      return configDisposals
    },
    dispose() {
      for (const dispose of effects.reverse()) dispose()
    },
  }
}

function entry(h: ReturnType<typeof createHarness>) {
  const found = h.registrations.find((registration) => registration.options.name === FOOTER_SLOT)
  if (found === undefined) throw new Error(`no registration in ${FOOTER_SLOT}`)
  return found
}

interface Face {
  open(): Promise<void>
  status: Observable<{ busy: boolean; error: string | undefined }>
}

describe("daily-workspace browser half", () => {
  it("waits for the services it calls", () => {
    expect(inject).toEqual([
      "slots",
      "locale",
      "configForms",
      "workspaces",
      "uiWorkspace",
      "remote",
    ])
  })

  it("keeps the settings form live for the configured root", () => {
    const h = createHarness()
    apply(h.ctx)
    expect(h.configNamespaces).toEqual([NAMESPACE])
    expect(h.configSubscribers).toBe(1)
    expect(h.configDisposals).toBe(0)
    h.dispose()
    expect(h.configSubscribers).toBe(0)
    expect(h.configDisposals).toBe(1)
  })

  it("adds one footer button after the scratch row", () => {
    const h = createHarness()
    apply(h.ctx)
    expect(h.registrations).toHaveLength(1)
    const button = entry(h)
    expect(button.component).toBe(OpenTodayFooterButton)
    expect(button.options.id).toBe(FOOTER_ID)
    expect(button.options.order).toBe(FOOTER_ORDER)
    expect(FOOTER_ORDER).toBeGreaterThan(0)
    expect(FOOTER_ORDER).toBeLessThan(10)
    expect(button.options.locale).toBe(NAMESPACE)
  })

  it("opens today's folder under the Host home", async () => {
    const h = createHarness()
    apply(h.ctx)
    const face = (entry(h).options.inject as () => Face)()
    await face.open()
    expect(h.openWorkspace).toHaveBeenCalledWith("ws-day")
  })

  it("opens a day folder under a configured absolute root", async () => {
    const h = createHarness({
      root: "/srv/docs",
      items: [workspace("ws-srv", "/srv/docs/2026/11/20")],
    })
    apply(h.ctx)
    const face = (entry(h).options.inject as () => Face)()
    await face.open()
    expect(h.openWorkspace).toHaveBeenCalledWith("ws-srv")
  })

  it("shows the root failure before the Host home is known", async () => {
    const h = createHarness({ home: undefined })
    apply(h.ctx)
    const face = (entry(h).options.inject as () => Face)()
    await face.open()
    expect(face.status.getSnapshot().error).toBe("error.root")
    expect(h.openWorkspace).not.toHaveBeenCalled()
  })

  it("removes everything on teardown", () => {
    const h = createHarness()
    apply(h.ctx)
    expect(h.locales).toEqual([NAMESPACE])
    expect(styleTags[0]?.dataset.plugin).toBe("@1outres/dsh-plugin-daily-workspace")
    h.dispose()
    expect(h.registrations).toEqual([])
    expect(h.locales).toEqual([])
    expect(styleTags[0]?.removed).toBe(true)
  })
})

describe("the footer button", () => {
  const t = (key: string) => key
  const idle = { busy: false, error: undefined }
  const open = async () => {}

  it("renders both labels and marks itself for the quick start row", () => {
    const html = renderToStaticMarkup(
      createElement(OpenTodayFooterButton, { wide: true, t, open, status: fixed(idle) }),
    )
    expect(html).toContain('data-dsh-quick-start=""')
    expect(html).toContain("dsh-today-label-full")
    expect(html).toContain("action.label")
    expect(html).toContain("dsh-today-label-short")
    expect(html).toContain("action.short")
    expect(html).toContain('aria-label="action.label"')
    expect(html).toContain('title="action.hint"')
  })

  it("shows progress and failures as one text", () => {
    const busy = renderToStaticMarkup(
      createElement(OpenTodayFooterButton, {
        wide: true,
        t,
        open,
        status: fixed({ busy: true, error: undefined }),
      }),
    )
    expect(busy).toContain("action.busy")
    expect(busy).toContain("disabled")
    expect(busy).not.toContain("dsh-today-label-short")
    const failed = renderToStaticMarkup(
      createElement(OpenTodayFooterButton, {
        wide: true,
        t,
        open,
        status: fixed({ busy: false, error: "nope" }),
      }),
    )
    expect(failed).toContain("data-error")
    expect(failed).toContain("nope")
    expect(failed).not.toContain("dsh-today-label-short")
  })

  it("keeps only the icon in the rail", () => {
    const rail = renderToStaticMarkup(
      createElement(OpenTodayFooterButton, {
        wide: false,
        t,
        open,
        status: fixed(idle),
      }),
    )
    expect(rail).toContain('data-rail=""')
    expect(rail).not.toContain("<span")
  })
})
