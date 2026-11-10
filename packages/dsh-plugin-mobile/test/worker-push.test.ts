import { describe, expect, it } from "vitest"
import type { PwaPushMessage } from "../src/worker/protocol"
import { buildNotification, DEFAULT_NOTIFICATION_TITLE, readPushMessage } from "../src/worker/push"

const raw = {
  dshPwa: 1,
  title: "Approval needed",
  options: {
    body: "Run the command?",
    tag: "approval:1",
    renotify: true,
    data: { dshPwa: 1, openUrl: "./?session=s1", payload: { sessionId: "s1" } },
  },
} satisfies PwaPushMessage

describe("push notifications", () => {
  it("parses the JSON body of a push message", () => {
    expect(readPushMessage({ json: () => raw })).toEqual(raw)
  })

  it("treats missing or unparsable data as no message", () => {
    expect(readPushMessage(null)).toBeNull()
    expect(readPushMessage(undefined)).toBeNull()
    expect(
      readPushMessage({
        json: () => {
          throw new SyntaxError("not JSON")
        },
      }),
    ).toBeNull()
    expect(readPushMessage({ json: () => ({ hello: "world" }) })).toBeNull()
  })

  it("builds the notification from a v1 message", () => {
    const notification = buildNotification(raw, "https://example.test/app/")
    expect(notification.title).toBe("Approval needed")
    expect(notification.options).toMatchObject({
      body: "Run the command?",
      tag: "approval:1",
      renotify: true,
      data: raw.options.data,
    })
    expect(notification.options.icon).toBe("https://example.test/app/icon-192.png")
    expect(notification.options.badge).toBe("https://example.test/app/icon-192.png")
  })

  it("shows a generic notification when the message is not protocol v1", () => {
    const notification = buildNotification(null, "https://example.test/")
    expect(notification.title).toBe(DEFAULT_NOTIFICATION_TITLE)
    expect(notification.options.body).toBeUndefined()
    expect(notification.options.tag).toBeUndefined()
    expect(notification.options.icon).toBe("https://example.test/icon-192.png")
    expect(notification.options.badge).toBe("https://example.test/icon-192.png")
  })
})
