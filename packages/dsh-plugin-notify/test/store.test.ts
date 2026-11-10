import { describe, expect, it } from "vitest"
import { DomainPushStore, subscriptionId } from "../src/host/push/store"
import { FakeDomain, pushSubscription } from "./fakes"

describe("subscriptionId", () => {
  it("hashes the endpoint to a url-safe key", () => {
    const id = subscriptionId("https://push.example.com/a")
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(subscriptionId("https://push.example.com/a")).toBe(id)
    expect(subscriptionId("https://push.example.com/b")).not.toBe(id)
  })
})

describe("DomainPushStore", () => {
  it("generates VAPID keys once and stores them", async () => {
    const domain = new FakeDomain()
    const store = new DomainPushStore(domain)

    const first = await store.vapid()
    const second = await store.vapid()

    expect(first).toEqual(second)
    expect(Buffer.from(first.publicKey, "base64url")).toHaveLength(65)
    expect(domain.value.vapid).toEqual(first)
  })

  it("reuses VAPID keys the domain already holds", async () => {
    const domain = new FakeDomain()
    domain.value = { vapid: { publicKey: "pub", privateKey: "priv" } }
    const store = new DomainPushStore(domain)

    expect(await store.vapid()).toEqual({ publicKey: "pub", privateKey: "priv" })
  })

  it("shares one generation between concurrent first uses", async () => {
    const domain = new FakeDomain()
    const store = new DomainPushStore(domain)

    const [first, second] = await Promise.all([store.vapid(), store.vapid()])
    expect(first).toEqual(second)
  })

  it("round-trips subscriptions by endpoint hash", async () => {
    const domain = new FakeDomain()
    const store = new DomainPushStore(domain)
    const record = pushSubscription()

    await store.put(record)

    expect(await store.get(record.endpoint)).toEqual(record)
    expect(domain.subscriptions.records.get(subscriptionId(record.endpoint))).toEqual(record)
    expect(await store.list()).toEqual([record])
    expect(await store.delete(record.endpoint)).toBe(true)
    expect(await store.get(record.endpoint)).toBeUndefined()
    expect(await store.delete(record.endpoint)).toBe(false)
  })

  it("closes the domain", async () => {
    const domain = new FakeDomain()
    const store = new DomainPushStore(domain)

    await store.close()
    expect(domain.closed).toBe(true)
  })
})
