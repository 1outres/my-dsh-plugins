import { describe, expect, it } from "vitest"
import { PRESENCE_TTL_MS, Presence } from "../src/host/push/presence"

describe("Presence", () => {
  it("attends while the page is visible and focused", () => {
    const presence = new Presence()
    presence.report("https://push.example.com/a", { visible: true, focused: true }, 1000)

    expect(presence.isAttended("https://push.example.com/a", 1000)).toBe(true)
    expect(presence.isAttended("https://push.example.com/a", 1000 + PRESENCE_TTL_MS - 1)).toBe(true)
  })

  it("stops attending after the time to live", () => {
    const presence = new Presence()
    presence.report("https://push.example.com/a", { visible: true, focused: true }, 1000)

    expect(presence.isAttended("https://push.example.com/a", 1000 + PRESENCE_TTL_MS)).toBe(false)
  })

  it("does not attend a hidden or unfocused page", () => {
    const presence = new Presence()
    presence.report("https://push.example.com/a", { visible: false, focused: true }, 1000)
    presence.report("https://push.example.com/b", { visible: true, focused: false }, 1000)

    expect(presence.isAttended("https://push.example.com/a", 1000)).toBe(false)
    expect(presence.isAttended("https://push.example.com/b", 1000)).toBe(false)
  })

  it("replaces an older report", () => {
    const presence = new Presence()
    presence.report("https://push.example.com/a", { visible: true, focused: true }, 1000)
    presence.report("https://push.example.com/a", { visible: false, focused: false }, 2000)

    expect(presence.isAttended("https://push.example.com/a", 2000)).toBe(false)
  })

  it("does not attend an endpoint without a report and can forget one", () => {
    const presence = new Presence()
    presence.report("https://push.example.com/a", { visible: true, focused: true }, 1000)
    presence.forget("https://push.example.com/a")

    expect(presence.isAttended("https://push.example.com/a", 1000)).toBe(false)
    expect(presence.isAttended("https://push.example.com/b", 1000)).toBe(false)
  })
})
