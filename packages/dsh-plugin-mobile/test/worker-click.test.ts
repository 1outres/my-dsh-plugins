import { describe, expect, it } from "vitest"
import {
  clickMessage,
  isInScope,
  openUrl,
  pickWindowClient,
  type WindowClientLike,
} from "../src/worker/sw/click"
import { PWA_CLICK_MESSAGE } from "../src/worker/sw/protocol"

function client(url: string, options: { focused?: boolean; visible?: boolean } = {}) {
  const calls = { focused: 0, messages: [] as unknown[] }
  const value: WindowClientLike = {
    url,
    focused: options.focused ?? false,
    visibilityState: options.visible === false ? "hidden" : "visible",
    focus: async () => {
      calls.focused += 1
    },
    postMessage: (message) => {
      calls.messages.push(message)
    },
  }
  return { value, calls }
}

describe("notification clicks", () => {
  it("keeps only windows inside the registration scope", () => {
    expect(isInScope("https://example.test/", "https://example.test/")).toBe(true)
    expect(isInScope("https://example.test/a/b", "https://example.test/")).toBe(true)
    expect(isInScope("https://example.test/app/a", "https://example.test/app/")).toBe(true)
    expect(isInScope("https://example.test/app", "https://example.test/app/")).toBe(false)
    expect(isInScope("https://example.test/application", "https://example.test/app/")).toBe(false)
    expect(isInScope("https://other.test/a", "https://example.test/")).toBe(false)
  })

  it("prefers a focused window, then a visible one, then the first in scope", () => {
    const first = client("https://example.test/one", { visible: false })
    const visible = client("https://example.test/two")
    const focused = client("https://example.test/three", { focused: true })
    const outside = client("https://other.test/", { focused: true })

    expect(
      pickWindowClient(
        [first.value, visible.value, focused.value, outside.value],
        "https://example.test/",
      ),
    ).toBe(focused.value)
    expect(pickWindowClient([first.value, visible.value], "https://example.test/")).toBe(
      visible.value,
    )
    expect(
      pickWindowClient(
        [client("https://example.test/a", { visible: false }).value],
        "https://example.test/",
      ),
    ).not.toBeNull()
    expect(pickWindowClient([outside.value], "https://example.test/")).toBeNull()
    expect(pickWindowClient([], "https://example.test/")).toBeNull()
  })

  it("posts the click message with the plugin payload and the notification tag", () => {
    expect(clickMessage({ dshPwa: 1, payload: { sessionId: "s1" } }, "approval:1")).toEqual({
      type: PWA_CLICK_MESSAGE,
      payload: { sessionId: "s1" },
      tag: "approval:1",
    })
    expect(clickMessage({ dshPwa: 1 }, undefined)).toEqual({ type: PWA_CLICK_MESSAGE })
    expect(clickMessage(null, "done")).toEqual({ type: PWA_CLICK_MESSAGE, tag: "done" })
  })

  it("opens the openUrl of the data, or the scope root", () => {
    expect(
      openUrl({ dshPwa: 1, openUrl: "./?dsh-notify-session=s1" }, "https://example.test/app/"),
    ).toBe("https://example.test/app/?dsh-notify-session=s1")
    expect(openUrl(null, "https://example.test/app/")).toBe("https://example.test/app/")
    expect(openUrl({ dshPwa: 1 }, "https://example.test/")).toBe("https://example.test/")
  })
})
