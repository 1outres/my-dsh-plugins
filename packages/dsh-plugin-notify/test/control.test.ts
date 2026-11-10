import { describe, expect, it } from "vitest"
import { PushControl } from "../src/host/push/control"
import { Presence } from "../src/host/push/presence"
import { subscriptionId } from "../src/host/push/store"
import { FakeSender, MemoryPushStore, pushSubscription } from "./fakes"

const ENDPOINT = "https://push.example.com/a"

async function createControl() {
  const store = new MemoryPushStore()
  const presence = new Presence()
  const sender = new FakeSender()
  const control = new PushControl({
    store,
    presence,
    sendTest: async (endpoint) => {
      const subscription = await store.get(endpoint)
      if (subscription === undefined) {
        return { failed: { status: 0, message: "not subscribed" } }
      }
      return sender.send(
        subscription,
        { dshPwa: 1, title: "Test", options: {} },
        {
          ttlSeconds: 300,
          urgency: "normal",
        },
      )
    },
    now: () => 1234,
  })
  return { store, presence, sender, control }
}

describe("PushControl", () => {
  it("reports the Host public key", async () => {
    const { control, store } = await createControl()

    expect(await control.publicKey()).toBe((await store.vapid()).publicKey)
  })

  it("stores a subscription with its creation time and returns the id", async () => {
    const { control, store } = await createControl()

    const id = await control.subscribe({
      endpoint: ENDPOINT,
      p256dh: "p256dh",
      auth: "auth",
      label: "Safari on iPhone",
    })

    expect(id).toBe(subscriptionId(ENDPOINT))
    expect(await store.get(ENDPOINT)).toEqual({
      endpoint: ENDPOINT,
      p256dh: "p256dh",
      auth: "auth",
      label: "Safari on iPhone",
      createdAt: 1234,
    })
    expect(await control.status(ENDPOINT)).toBe(true)
  })

  it("removes a subscription and its presence", async () => {
    const { control, presence, store } = await createControl()
    await store.put(pushSubscription({ endpoint: ENDPOINT }))
    presence.report(ENDPOINT, { visible: true, focused: true }, 1234)

    expect(await control.unsubscribe(ENDPOINT)).toBe(true)
    expect(await control.status(ENDPOINT)).toBe(false)
    expect(presence.isAttended(ENDPOINT, 1234)).toBe(false)
  })

  it("records presence", async () => {
    const { control, presence } = await createControl()

    control.presence(ENDPOINT, true, false)

    expect(presence.isAttended(ENDPOINT, 1234)).toBe(false)
    control.presence(ENDPOINT, true, true)
    expect(presence.isAttended(ENDPOINT, 1234)).toBe(true)
  })

  it("reports a test push result", async () => {
    const { control, store } = await createControl()
    await store.put(pushSubscription({ endpoint: ENDPOINT }))

    expect(await control.test(ENDPOINT)).toBe("sent")
    expect(await control.test("https://push.example.com/other")).toBe("failed")
  })
})
