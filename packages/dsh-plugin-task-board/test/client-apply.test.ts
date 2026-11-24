import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { apply, inject, NAMESPACE, PANEL_ID } from "../src/client/index"
import type {
  ClientContext,
  CommandDecoration,
  CommandsRemote,
  SelectOption,
  SlotRegistration,
} from "../src/client/types"
import { SESSION_BOARD, SNAPSHOT, translate } from "./client-support"

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

interface Harness {
  ctx: ClientContext
  registrations: { options: SlotRegistration; component: unknown }[]
  slotKeys: string[]
  sections: string[]
  dictionaries: string[]
  decorations: CommandDecoration[]
  disposedDecorations: number
  effects: (() => void)[]
  selectPanel: ReturnType<typeof vi.fn>
  mount: ReturnType<typeof vi.fn>
  execute: ReturnType<typeof vi.fn>
  dispose(): void
}

function harness(): Harness {
  const registrations: { options: SlotRegistration; component: unknown }[] = []
  const slotKeys: string[] = []
  const sections: string[] = []
  const dictionaries: string[] = []
  const decorations: CommandDecoration[] = []
  const effects: (() => void)[] = []
  let disposedDecorations = 0
  const selectPanel = vi.fn()
  const mount = vi.fn(async () => async () => {})
  const execute = vi.fn<CommandsRemote["execute"]>(async () => ({
    ok: true,
    value: { result: { kind: "success" } },
  }))
  const taskBoard = {
    projects: async () => ({
      ok: true,
      value: [{ path: "/work/repo", title: "repo", workspaceId: "w" }],
    }),
    projectOfSession: async () => ({
      ok: true,
      value: { status: "ok", value: { path: "/work/repo", title: "repo", workspaceId: "w" } },
    }),
    boardOfSession: async () => ({ ok: true, value: { status: "ok", value: SESSION_BOARD } }),
    watch: () => ({
      [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }),
      dispose() {},
    }),
    createCard: async () => ({ ok: true, value: { status: "ok", value: SNAPSHOT.cards[0] } }),
    updateCard: async () => ({ ok: true, value: { status: "ok", value: SNAPSHOT.cards[0] } }),
    moveCard: async () => ({ ok: true, value: { status: "ok", value: SNAPSHOT.cards[0] } }),
    deleteCard: async () => ({ ok: true, value: { status: "ok", value: null } }),
    addComment: async () => ({
      ok: true,
      value: { status: "ok", value: SNAPSHOT.cards[0]?.comments[0] },
    }),
    deleteComment: async () => ({ ok: true, value: { status: "ok", value: null } }),
    unlinkSession: async () => ({ ok: true, value: { status: "ok", value: SNAPSHOT.cards[0] } }),
    addColumn: async () => ({
      ok: true,
      value: {
        status: "ok",
        value: { id: "new", title: { kind: "text", text: "New" }, cardNumbers: [] },
      },
    }),
    renameColumn: async () => ({
      ok: true,
      value: {
        status: "ok",
        value: { id: "todo", title: { kind: "text", text: "New" }, cardNumbers: [] },
      },
    }),
    moveColumn: async () => ({ ok: true, value: { status: "ok", value: SNAPSHOT.board } }),
    deleteColumn: async () => ({ ok: true, value: { status: "ok", value: null } }),
  }
  const commandUi = {
    decorate: (decoration: CommandDecoration) => {
      decorations.push(decoration)
      return () => {
        disposedDecorations += 1
      }
    },
  }
  const ctx = {
    effect: (run: () => (() => void) | undefined) => {
      const dispose = run()
      if (dispose !== undefined) effects.push(dispose)
    },
    get: (name: string) => {
      if (name === "commandUi") return commandUi
      if (name === "remote.taskBoard") return taskBoard
      return undefined
    },
    inject: (deps: string[], callback: (scope: ClientContext) => void) => {
      sections.push(deps.join(","))
      callback(ctx as unknown as ClientContext)
    },
    slots: {
      inject: (key: string, register: () => () => void) => {
        slotKeys.push(key)
        return register()
      },
      register: (options: SlotRegistration, component: unknown) => {
        const entry = { options, component }
        registrations.push(entry)
        return () => {
          registrations.splice(registrations.indexOf(entry), 1)
        }
      },
    },
    locale: {
      register: (namespace: string) => {
        dictionaries.push(namespace)
        return () => {
          dictionaries.splice(dictionaries.indexOf(namespace), 1)
        }
      },
      bind: () => translate,
    },
    remote: { $mount: mount, commands: { execute } },
    layout: { selectPanel },
  }
  return {
    ctx: ctx as unknown as ClientContext,
    registrations,
    slotKeys,
    sections,
    dictionaries,
    decorations,
    get disposedDecorations() {
      return disposedDecorations
    },
    effects,
    selectPanel,
    mount,
    execute,
    dispose() {
      for (const dispose of effects.reverse()) dispose()
    },
  }
}

describe("task board client half", () => {
  it("declares the services it needs", () => {
    expect(inject).toEqual(["slots", "locale", "remote", "layout"])
  })

  it("registers dictionaries and the stylesheet", () => {
    const h = harness()
    apply(h.ctx)
    expect(h.dictionaries).toEqual([NAMESPACE])
    expect(styleTags).toHaveLength(1)
    expect(styleTags[0]?.dataset.plugin).toBe("@1outres/dsh-plugin-task-board")
    expect(styleTags[0]?.textContent).toContain(".tb-")
    h.dispose()
    expect(styleTags[0]?.removed).toBe(true)
  })

  it("registers the main panel, its sidebar entry, and the session header button", () => {
    const h = harness()
    apply(h.ctx)
    expect(h.slotKeys).toEqual([
      "main",
      "sidebar.panellist",
      "conversation.session.header.utilities",
    ])
    expect(h.registrations.map(({ options }) => options)).toMatchObject([
      { name: "main", key: PANEL_ID, locale: NAMESPACE },
      { name: "sidebar.panellist", id: PANEL_ID, locale: NAMESPACE },
      { name: "conversation.session.header.utilities", id: "task-board", locale: NAMESPACE },
    ])
    const sidebar = h.registrations[1]?.options
    if (sidebar === undefined) throw new Error("expected the sidebar entry")
    expect((sidebar.label as () => string)()).toBe("Task board")
    h.dispose()
    expect(h.registrations).toEqual([])
  })

  it("gives the page its bridge and stores", () => {
    const h = harness()
    apply(h.ctx)
    const main = h.registrations[0]?.options
    if (main === undefined) throw new Error("expected the main entry")
    const face = (main.inject as () => Record<string, unknown>)()
    expect(typeof face.bridge).toBe("object")
    expect(typeof face.projects).toBe("object")
    expect(typeof face.board).toBe("object")
    expect(typeof face.t).toBe("function")
    h.dispose()
  })

  it("opens the board of a session's project from the header", async () => {
    const h = harness()
    apply(h.ctx)
    const header = h.registrations[2]?.options
    if (header === undefined) throw new Error("expected the header entry")
    const face = (header.inject as (sessionId: string) => Record<string, unknown>)("session-1")
    expect(face.sessionId).toBe("session-1")
    await (face.open as (sessionId: string) => Promise<void>)("session-1")
    expect(h.selectPanel).toHaveBeenCalledWith(PANEL_ID)
    h.dispose()
  })

  it("decorates the bare /task command with a grouped card picker", async () => {
    const h = harness()
    apply(h.ctx)
    expect(h.sections).toEqual(["commandUi"])
    expect(h.decorations.map((decoration) => decoration.name)).toEqual(["task"])
    const decoration = h.decorations[0]
    if (decoration === undefined) throw new Error("expected the decoration")
    expect(decoration.available({ sessionId: "session-1" })).toBe(true)
    expect(decoration.ui.searchLabels?.()).toEqual({
      placeholder: "Search cards",
      empty: "This board has no cards.",
      noResults: "No cards match.",
    })
    const options = await decoration.ui.options(
      { sessionId: "session-1" },
      new AbortController().signal,
    )
    expect(options.map((option: SelectOption) => option.id)).toEqual(["1", "2", "3"])
    await decoration.ui.onSelect(options[0] as SelectOption, { sessionId: "session-1" })
    expect(h.execute).toHaveBeenCalledWith("session-1", "/task 1", [])
    h.dispose()
    expect(h.disposedDecorations).toBe(1)
  })
})
