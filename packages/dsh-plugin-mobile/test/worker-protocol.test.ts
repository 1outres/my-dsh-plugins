import { describe, expect, it } from "vitest"
import {
  PWA_CLICK_MESSAGE,
  PWA_PROTOCOL_VERSION,
  parseNotificationData,
  parsePushMessage,
  WORKER_SCOPE,
  WORKER_SCRIPT_PATH,
  WORKER_SCRIPT_URL,
} from "../src/worker/protocol"

const message = {
  dshPwa: 1,
  title: "Approval needed",
  options: {
    body: "Run the command?",
    tag: "approval:1",
    renotify: true,
    requireInteraction: true,
    silent: false,
    data: {
      dshPwa: 1,
      openUrl: "./?dsh-notify-session=s1",
      payload: { sessionId: "s1" },
    },
  },
}

describe("PWA worker protocol v1", () => {
  it("pins the version, the script location and the click message name", () => {
    expect(PWA_PROTOCOL_VERSION).toBe(1)
    expect(WORKER_SCRIPT_PATH).toBe("/dsh-mobile-sw.js")
    expect(WORKER_SCRIPT_URL).toBe("./dsh-mobile-sw.js")
    expect(WORKER_SCOPE).toBe("./")
    expect(PWA_CLICK_MESSAGE).toBe("dsh-pwa:notificationclick")
  })

  it("accepts a complete push message", () => {
    expect(parsePushMessage(message)).toEqual(message)
  })

  it("drops option keys the protocol does not define", () => {
    const parsed = parsePushMessage({
      ...message,
      options: { ...message.options, icon: "https://example.test/evil.png" },
    })
    expect(parsed).toEqual(message)
    expect(parsed?.options).not.toHaveProperty("icon")
  })

  it("rejects another protocol version", () => {
    expect(parsePushMessage({ ...message, dshPwa: 2 })).toBeNull()
    expect(parsePushMessage({ ...message, dshPwa: "1" })).toBeNull()
  })

  it("rejects a message without a title or options", () => {
    expect(parsePushMessage({ dshPwa: 1, options: {} })).toBeNull()
    expect(parsePushMessage({ dshPwa: 1, title: "x" })).toBeNull()
    expect(parsePushMessage([message])).toBeNull()
    expect(parsePushMessage(null)).toBeNull()
  })

  it("rejects wrongly typed options", () => {
    expect(parsePushMessage({ ...message, options: { body: 3 } })).toBeNull()
    expect(parsePushMessage({ ...message, options: { tag: true } })).toBeNull()
    expect(parsePushMessage({ ...message, options: { renotify: "yes" } })).toBeNull()
    expect(parsePushMessage({ ...message, options: { requireInteraction: 1 } })).toBeNull()
    expect(parsePushMessage({ ...message, options: { silent: null } })).toBeNull()
    expect(
      parsePushMessage({ ...message, options: { data: { dshPwa: 1, openUrl: 2 } } }),
    ).toBeNull()
  })

  it("accepts notification data with or without the optional fields", () => {
    expect(parseNotificationData({ dshPwa: 1 })).toEqual({ dshPwa: 1 })
    expect(parseNotificationData(message.options.data)).toEqual(message.options.data)
    expect(parseNotificationData({ dshPwa: 1, payload: { a: [1, true, "x"] } })).toEqual({
      dshPwa: 1,
      payload: { a: [1, true, "x"] },
    })
  })

  it("rejects notification data without the version marker", () => {
    expect(parseNotificationData({})).toBeNull()
    expect(parseNotificationData({ dshPwa: 2 })).toBeNull()
    expect(parseNotificationData("dshPwa")).toBeNull()
    expect(parseNotificationData(undefined)).toBeNull()
  })
})
