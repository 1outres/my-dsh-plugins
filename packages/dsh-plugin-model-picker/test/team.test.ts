import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { TeamRow, type TeamRowProps } from "../src/client/TeamRow"
import { createTeamModeStore, teamToggleAction } from "../src/client/team"

describe("team mode store", () => {
  it("offers a save function only while the remote face is connected", async () => {
    const store = createTeamModeStore()
    const listener = vi.fn()
    store.subscribe(listener)
    expect(store.getSnapshot()).toBeNull()

    const setEnabled = vi.fn(async () => ({ ok: true as const, value: undefined }))
    const disconnect = store.connect({ setEnabled })
    const save = store.getSnapshot()
    expect(save).not.toBeNull()
    await expect(save?.("s1", true)).resolves.toBeNull()
    expect(setEnabled).toHaveBeenCalledWith("s1", true)

    disconnect()
    expect(store.getSnapshot()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it("reports the Host's failure message", async () => {
    const store = createTeamModeStore()
    store.connect({
      setEnabled: async () => ({ ok: false as const, error: { code: "x", message: "boom" } }),
    })
    await expect(store.getSnapshot()?.("s1", false)).resolves.toBe("boom")
  })

  it("keeps a newer connection when an older one disconnects", () => {
    const store = createTeamModeStore()
    const setEnabled = async () => ({ ok: true as const, value: undefined })
    const first = store.connect({ setEnabled })
    store.connect({ setEnabled })
    const second = store.getSnapshot()
    first()
    expect(store.getSnapshot()).toBe(second)
  })
})

describe("teamToggleAction", () => {
  it("saves turning teamwork on right away", () => {
    expect(teamToggleAction(true, { lastUsed: { provider: "p", model: "m" } })).toBe("save")
  })

  it("asks before turning teamwork off in a Session that has run", () => {
    expect(teamToggleAction(false, { lastUsed: { provider: "p", model: "m" } })).toBe("confirm")
  })

  it("turns teamwork off without asking before the first model step", () => {
    expect(teamToggleAction(false, { lastUsed: null })).toBe("save")
    expect(teamToggleAction(false, undefined)).toBe("save")
  })
})

function render(overrides: Partial<TeamRowProps> = {}): string {
  const props: TeamRowProps = {
    sessionId: "s1",
    mode: { enabled: false },
    modelSelection: { lastUsed: null },
    save: async () => null,
    locked: false,
    reportFailure: () => {},
    restoreFocus: () => {},
    t: (key) => key,
    ...overrides,
  }
  return renderToStaticMarkup(createElement(TeamRow, props))
}

describe("team row", () => {
  it("shows the saved selection as a switch", () => {
    expect(render()).toContain('role="switch" aria-checked="false"')
    const on = render({ mode: { enabled: true } })
    expect(on).toContain('aria-checked="true"')
    expect(on).toContain("dsh-mp-switch-on")
    expect(on).toContain("team.label")
  })

  it("is disabled while locked or before the model selection arrives", () => {
    expect(render()).not.toMatch(/role="switch"[^>]*disabled=""/u)
    expect(render({ locked: true })).toMatch(/role="switch"[^>]*disabled=""/u)
    expect(render({ modelSelection: undefined })).toMatch(/role="switch"[^>]*disabled=""/u)
  })
})
