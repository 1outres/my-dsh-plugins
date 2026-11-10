import { describe, expect, it, vi } from "vitest"
import {
  createNotificationSink,
  type NotificationLike,
  type RegistrationLike,
  type SinkSpec,
  selectNotificationSink,
} from "../src/client/sink"
import type { PwaNotificationData } from "../src/shared/protocol"

const DATA: PwaNotificationData = { dshPwa: 1, payload: { sessionId: "s1" } }

const spec: SinkSpec = {
  title: "Approval needed",
  body: "Fix login",
  tag: "dsh-notify:approval:s1",
  data: DATA,
}

function fakeNotification() {
  const notifications: FakeNotification[] = []
  class FakeNotification implements NotificationLike {
    onclick: (() => void) | null = null
    onclose: (() => void) | null = null
    closed = false
    constructor(
      readonly title: string,
      readonly options: {
        body: string
        tag: string
        data: PwaNotificationData
        renotify?: boolean
      },
    ) {
      notifications.push(this)
    }

    close(): void {
      if (this.closed) return
      this.closed = true
      this.onclose?.()
    }
  }
  return { FakeNotification, notifications }
}

describe("RegistrationSink", () => {
  it("shows through the registration with the worker data", async () => {
    const calls: unknown[] = []
    const notifications: { close(): void; closed: boolean }[] = []
    const registration: RegistrationLike = {
      showNotification: async (title, options) => {
        calls.push([title, options])
      },
      getNotifications: async () => {
        const notification = {
          closed: false,
          close() {
            this.closed = true
          },
        }
        notifications.push(notification)
        return [notification]
      },
    }
    const sink = createNotificationSink({ kind: "registration", registration })
    if (sink === undefined) throw new Error("no sink")

    await sink.show(spec)
    await sink.close(spec.tag)
    await sink.closeAll()

    expect(calls).toEqual([
      [
        "Approval needed",
        {
          body: "Fix login",
          tag: "dsh-notify:approval:s1",
          data: DATA,
          renotify: undefined,
        },
      ],
    ])
    expect(notifications.every((notification) => notification.closed)).toBe(true)
  })
})

describe("WindowSink", () => {
  it("shows a page notification and closes it on click", async () => {
    const { FakeNotification, notifications } = fakeNotification()
    const onClick = vi.fn()
    const sink = createNotificationSink({
      kind: "window",
      Notification: FakeNotification,
      onClick,
    })
    if (sink === undefined) throw new Error("no sink")

    await sink.show(spec)
    notifications[0]?.onclick?.()

    expect(onClick).toHaveBeenCalledWith(DATA)
    expect(notifications[0]?.closed).toBe(true)
  })

  it("replaces a notification with the same tag", async () => {
    const { FakeNotification, notifications } = fakeNotification()
    const sink = createNotificationSink({
      kind: "window",
      Notification: FakeNotification,
      onClick: () => {},
    })
    if (sink === undefined) throw new Error("no sink")

    await sink.show(spec)
    await sink.show({ ...spec, body: "again" })

    expect(notifications).toHaveLength(2)
    expect(notifications[0]?.closed).toBe(true)
    expect(notifications[1]?.closed).toBe(false)
  })

  it("closes every notification", async () => {
    const { FakeNotification, notifications } = fakeNotification()
    const sink = createNotificationSink({
      kind: "window",
      Notification: FakeNotification,
      onClick: () => {},
    })
    if (sink === undefined) throw new Error("no sink")

    await sink.show(spec)
    await sink.show({ ...spec, tag: "other" })
    await sink.closeAll()

    expect(notifications.every((notification) => notification.closed)).toBe(true)
  })
})

describe("createNotificationSink", () => {
  it("returns no sink when the page has no notification API", () => {
    expect(createNotificationSink({ kind: "none" })).toBeUndefined()
  })
})

describe("selectNotificationSink", () => {
  it("prefers the service worker registration when it controls the page", async () => {
    const registration: RegistrationLike = {
      showNotification: async () => {},
      getNotifications: async () => [],
    }
    const sink = await selectNotificationSink({
      serviceWorker: { controller: {}, ready: Promise.resolve(registration) },
      onClick: () => {},
    })

    expect(sink).toBeDefined()
  })

  it("uses the page Notification API without a controlling worker", async () => {
    const { FakeNotification } = fakeNotification()
    const sink = await selectNotificationSink({
      serviceWorker: { controller: null, ready: Promise.resolve({} as RegistrationLike) },
      Notification: FakeNotification,
      onClick: () => {},
    })

    expect(sink).toBeDefined()
  })

  it("returns no sink when neither is available", async () => {
    expect(await selectNotificationSink({ onClick: () => {} })).toBeUndefined()
  })
})
