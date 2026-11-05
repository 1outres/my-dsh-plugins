import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NewScratchChip, NewScratchFooterButton } from "../src/client/components"
import { apply, COMMAND, FOOTER_SLOT, HERO_SLOT, inject, NAMESPACE } from "../src/client/index"
import type { ScratchStatus } from "../src/client/scratch"
import type {
  ClientContext,
  CommandContribution,
  Observable,
  SessionListState,
} from "../src/client/types"

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

function createHarness(options: { commandUi?: boolean; home?: string } = {}) {
  const effects: (() => void)[] = []
  const registrations: { options: Record<string, unknown>; component: unknown }[] = []
  const commands: CommandContribution[] = []
  const locales: string[] = []
  const created: string[] = []
  const sessionList: SessionListState = {
    byId: { blank: { cwd: "/home/me/.dsh/scratchpad", blank: true } },
  }

  const effect = (run: () => (() => void) | undefined) => {
    const dispose = run()
    if (typeof dispose === "function") effects.push(dispose)
  }
  const ctx = {
    effect,
    inject: (deps: string[], callback: (child: ClientContext) => void) => {
      if (deps.includes("commandUi") && options.commandUi === false) return
      callback(ctx as unknown as ClientContext)
    },
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
      get: () => ({
        getSnapshot: () => ({ status: "ready", value: { root: "~/.dsh/scratchpad" } }),
        subscribe: () => () => {},
      }),
    },
    sessions: {
      list: fixed(sessionList),
      create: async ({ cwd }: { cwd: string }) => {
        created.push(cwd)
        return "s-new"
      },
    },
    workspaces: {
      list: fixed({
        items: [
          {
            workspaceId: "ws-new",
            path: "/home/me/.dsh/scratchpad/x",
            title: "x",
            sessionIds: ["s-new"],
            createdAt: "2026-11-05T00:00:00Z",
          },
        ],
        archivedSessionIds: ["s-new"],
      }),
    },
    uiWorkspace: { openSession: vi.fn(), openWorkspace: vi.fn(async () => {}) },
    remote: { $host: { home: options.home ?? "/home/me" } },
    commandUi: {
      register: (command: CommandContribution) => {
        commands.push(command)
        return () => {
          commands.splice(commands.indexOf(command), 1)
        }
      },
    },
  }
  return {
    ctx: ctx as unknown as ClientContext,
    raw: ctx,
    registrations,
    commands,
    locales,
    created,
    dispose() {
      for (const dispose of effects.reverse()) dispose()
    },
  }
}

function entry(h: ReturnType<typeof createHarness>, slot: string) {
  const found = h.registrations.find((registration) => registration.options.name === slot)
  if (found === undefined) throw new Error(`no registration in ${slot}`)
  return found
}

describe("scratchpad client half", () => {
  it("waits for the services it calls; the command service stays optional", () => {
    expect(inject).toEqual(
      expect.arrayContaining(["slots", "sessions", "workspaces", "uiWorkspace", "remote"]),
    )
    expect(inject).not.toContain("commandUi")
  })

  it("adds the sidebar button, the New Session chip and /scratch", () => {
    const h = createHarness()
    apply(h.ctx)

    expect(entry(h, FOOTER_SLOT).component).toBe(NewScratchFooterButton)
    expect(entry(h, FOOTER_SLOT).options.locale).toBe(NAMESPACE)
    expect(entry(h, HERO_SLOT).component).toBe(NewScratchChip)
    expect(h.commands.map((command) => command.name)).toEqual([COMMAND])
    expect(h.commands[0]?.available({ sessionId: "any" })).toBe(true)
  })

  it("still adds both buttons without the command service", () => {
    const h = createHarness({ commandUi: false })
    apply(h.ctx)
    expect(h.registrations).toHaveLength(2)
    expect(h.commands).toEqual([])
  })

  it("creates the scratch under the Host home from every entry point", async () => {
    const h = createHarness()
    apply(h.ctx)
    const face = (entry(h, FOOTER_SLOT).options.inject as () => { start(): Promise<void> })()
    await face.start()

    expect(h.created).toEqual([expect.stringMatching(/^\/home\/me\/\.dsh\/scratchpad\/\d{4}-/)])
    expect(h.raw.uiWorkspace.openWorkspace).toHaveBeenCalledWith("ws-new")
  })

  it("shows the chip only on a blank Session of the root Workspace", () => {
    const h = createHarness()
    apply(h.ctx)
    const inject = entry(h, HERO_SLOT).options.inject as (id: string) => {
      isRoot(cwd: string | undefined): boolean
      sessionId: string
    }
    const face = inject("blank")
    expect(face.sessionId).toBe("blank")
    expect(face.isRoot("/home/me/.dsh/scratchpad")).toBe(true)
    expect(face.isRoot("/home/me/.dsh/scratchpad/x")).toBe(false)
  })

  it("removes everything on teardown", () => {
    const h = createHarness()
    apply(h.ctx)
    expect(h.locales).toEqual([NAMESPACE])
    expect(styleTags[0]?.dataset.plugin).toBe("@1outres/dsh-plugin-scratchpad")
    h.dispose()
    expect(h.registrations).toEqual([])
    expect(h.commands).toEqual([])
    expect(h.locales).toEqual([])
    expect(styleTags[0]?.removed).toBe(true)
  })
})

describe("buttons", () => {
  const t = (key: string) => key
  const idle: ScratchStatus = { busy: false, error: undefined }
  const start = async () => {}

  it("labels the sidebar button when wide and keeps only the icon in the rail", () => {
    const wide = renderToStaticMarkup(
      createElement(NewScratchFooterButton, { wide: true, t, start, status: fixed(idle) }),
    )
    expect(wide).toContain("action.label")
    expect(wide).toContain('title="action.hint"')
    const rail = renderToStaticMarkup(
      createElement(NewScratchFooterButton, { wide: false, t, start, status: fixed(idle) }),
    )
    expect(rail).toContain('data-rail=""')
    expect(rail).not.toContain("<span")
  })

  it("shows progress and failures", () => {
    const busy = renderToStaticMarkup(
      createElement(NewScratchFooterButton, {
        wide: true,
        t,
        start,
        status: fixed({ busy: true, error: undefined }),
      }),
    )
    expect(busy).toContain("action.busy")
    expect(busy).toContain("disabled")
    const failed = renderToStaticMarkup(
      createElement(NewScratchFooterButton, {
        wide: true,
        t,
        start,
        status: fixed({ busy: false, error: "nope" }),
      }),
    )
    expect(failed).toContain("data-error")
    expect(failed).toContain("nope")
  })

  it("renders the chip only for the root Session", () => {
    const sessions = fixed<SessionListState>({ byId: { a: { cwd: "/r", blank: true } } })
    const props = { t, start, status: fixed(idle), sessions, sessionId: "a" }
    const shown = renderToStaticMarkup(
      createElement(NewScratchChip, { ...props, isRoot: (cwd) => cwd === "/r" }),
    )
    expect(shown).toContain("chip.label")
    const hidden = renderToStaticMarkup(
      createElement(NewScratchChip, { ...props, isRoot: () => false }),
    )
    expect(hidden).toBe("")
  })
})
