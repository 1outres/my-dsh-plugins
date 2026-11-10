import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "../src/client/config"
import {
  COMPLETION_TTL_SECONDS,
  NotificationDispatcher,
  PENDING_DELAY_MS,
  PENDING_TTL_SECONDS,
} from "../src/host/dispatcher"
import { Presence } from "../src/host/push/presence"
import { topicOf } from "../src/host/push/sender"
import type { SessionStatusSource } from "../src/host/watch"
import type { SessionStatusLike, SessionStatusMap } from "../src/shared/types"
import { FakeSender, MemoryPushStore, pushSubscription } from "./fakes"

const APPROVAL = "https://push.example.com/a"
const PHONE = "https://push.example.com/b"

class FakeSource implements SessionStatusSource {
  snapshot: SessionStatusMap = new Map()
  readonly listeners = new Set<() => void>()
  title = "Fix login"

  getSnapshot(): SessionStatusMap {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  titleOf(_sessionId: string): string {
    return this.title
  }

  set(entries: Record<string, SessionStatusLike>): void {
    this.snapshot = new Map(Object.entries(entries))
    for (const listener of [...this.listeners]) listener()
  }
}

function approval(key = "approval:1"): SessionStatusLike["pendingInteraction"] {
  return { key, kind: "approval", toolName: "bash", reason: "escalate sandbox" }
}

interface HarnessOptions {
  readonly config?: Partial<typeof DEFAULT_CONFIG>
  readonly present?: (presence: Presence) => void
}

async function createHarness(options: HarnessOptions = {}) {
  const source = new FakeSource()
  const store = new MemoryPushStore()
  await store.put(pushSubscription({ endpoint: APPROVAL }))
  await store.put(pushSubscription({ endpoint: PHONE, label: "Chrome on Android" }))
  const presence = new Presence()
  options.present?.(presence)
  const sender = new FakeSender()
  const warnings: string[] = []
  let config = { ...DEFAULT_CONFIG, ...options.config }
  const dispatcher = new NotificationDispatcher({
    watcher: source,
    store,
    presence,
    sender,
    config: () => config,
    logger: { warn: (message) => warnings.push(message) },
  })
  const stop = dispatcher.start()

  return {
    source,
    store,
    presence,
    sender,
    warnings,
    dispatcher,
    stop,
    setConfig(next: Partial<typeof DEFAULT_CONFIG>) {
      config = { ...config, ...next }
    },
  }
}

function messageOf(sent: FakeSender["sent"][number]) {
  return sent.message
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("NotificationDispatcher", () => {
  it("sends a completion at once to an unattended subscription", async () => {
    const harness = await createHarness()
    harness.presence.report(APPROVAL, { visible: true, focused: true }, Date.now())
    harness.source.set({ s1: { running: true, completionUnread: false } })
    harness.source.set({ s1: { running: false, completionUnread: false } })
    await vi.waitFor(() => expect(harness.sender.sent).toHaveLength(1))

    const sent = harness.sender.sent[0]
    if (sent === undefined) throw new Error("no push was sent")
    expect(sent.subscription.endpoint).toBe(PHONE)
    expect(sent.options).toEqual({
      ttlSeconds: COMPLETION_TTL_SECONDS,
      urgency: "normal",
      topic: topicOf("dsh-notify:completion:s1"),
    })
    expect(messageOf(sent)).toEqual({
      dshPwa: 1,
      title: "Turn finished",
      options: {
        body: "Fix login",
        tag: "dsh-notify:completion:s1",
        renotify: false,
        data: {
          dshPwa: 1,
          openUrl: "./?dsh-notify-session=s1",
          payload: { sessionId: "s1" },
        },
      },
    })
  })

  it("delays a pending interaction and sends it when still pending", async () => {
    const harness = await createHarness({ present: () => {} })
    harness.source.set({
      s1: { running: true, completionUnread: false, pendingInteraction: approval() },
    })

    await vi.advanceTimersByTimeAsync(PENDING_DELAY_MS - 1)
    expect(harness.sender.sent).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(harness.sender.sent.length).toBeGreaterThan(0))

    const sent = harness.sender.sent[0]
    if (sent === undefined) throw new Error("no push was sent")
    expect(sent.options.ttlSeconds).toBe(PENDING_TTL_SECONDS)
    expect(sent.options.urgency).toBe("high")
    expect(messageOf(sent).title).toBe("Approval needed")
    expect(messageOf(sent).options.body).toBe("Fix login · bash: escalate sandbox")
    expect(messageOf(sent).options.renotify).toBe(true)
  })

  it("does not send a pending interaction resolved during the delay", async () => {
    const harness = await createHarness()
    harness.source.set({
      s1: { running: true, completionUnread: false, pendingInteraction: approval() },
    })
    harness.source.set({ s1: { running: true, completionUnread: false } })

    await vi.advanceTimersByTimeAsync(PENDING_DELAY_MS)
    expect(harness.sender.sent).toHaveLength(0)
  })

  it("reads the live config at decision time", async () => {
    const harness = await createHarness({ config: { push: false } })
    harness.source.set({ s1: { running: true, completionUnread: false } })
    harness.source.set({ s1: { running: false, completionUnread: false } })
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.sender.sent).toHaveLength(0)

    harness.setConfig({ push: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.sender.sent).toHaveLength(0)

    harness.source.set({ s1: { running: true, completionUnread: false } })
    harness.source.set({ s1: { running: false, completionUnread: false } })
    await vi.waitFor(() => expect(harness.sender.sent.length).toBeGreaterThan(0))
  })

  it("obeys the master switch", async () => {
    const harness = await createHarness({ config: { enabled: false } })
    harness.source.set({ s1: { running: true, completionUnread: false } })
    harness.source.set({ s1: { running: false, completionUnread: false } })
    await vi.advanceTimersByTimeAsync(0)

    expect(harness.sender.sent).toHaveLength(0)
  })

  it("hides detail when the setting is off", async () => {
    const harness = await createHarness({ config: { showDetail: false } })
    harness.source.set({
      s1: { running: true, completionUnread: false, pendingInteraction: approval() },
    })
    await vi.advanceTimersByTimeAsync(PENDING_DELAY_MS)
    await vi.waitFor(() => expect(harness.sender.sent.length).toBeGreaterThan(0))

    expect(messageOf(harness.sender.sent[0] as FakeSender["sent"][number]).options.body).toBe(
      "Fix login",
    )
  })

  it("sends to an attended subscription when focus gating is off", async () => {
    const harness = await createHarness({ config: { onlyWhenUnfocused: false } })
    harness.presence.report(APPROVAL, { visible: true, focused: true }, Date.now())
    harness.presence.report(PHONE, { visible: true, focused: true }, Date.now())
    harness.source.set({ s1: { running: true, completionUnread: false } })
    harness.source.set({ s1: { running: false, completionUnread: false } })
    await vi.waitFor(() => expect(harness.sender.sent).toHaveLength(2))
  })

  it("deletes a subscription the push service reports gone", async () => {
    const harness = await createHarness()
    harness.sender.fallback = "gone"
    harness.source.set({ s1: { running: true, completionUnread: false } })
    harness.source.set({ s1: { running: false, completionUnread: false } })
    await vi.waitFor(() => expect(harness.sender.sent).toHaveLength(2))

    expect(await harness.store.list()).toEqual([])
  })

  it("warns once per subscription and failure kind", async () => {
    const harness = await createHarness()
    harness.sender.fallback = { failed: { status: 500, message: "boom" } }
    harness.source.set({ s1: { running: true, completionUnread: false } })
    harness.source.set({ s1: { running: false, completionUnread: false } })
    await vi.waitFor(() => expect(harness.sender.sent).toHaveLength(2))

    expect(harness.warnings).toHaveLength(2)
    expect(harness.warnings[0]).toContain("https://push.example.com")
    expect(harness.warnings[0]).not.toContain("/a")

    harness.presence.report(APPROVAL, { visible: false, focused: false }, Date.now())
    harness.presence.report(PHONE, { visible: false, focused: false }, Date.now())
    harness.source.set({ s1: { running: true, completionUnread: false } })
    harness.source.set({ s1: { running: false, completionUnread: false } })
    await vi.waitFor(() => expect(harness.sender.sent).toHaveLength(4))
    expect(harness.warnings).toHaveLength(2)
  })

  it("cancels delayed sends on dispose", async () => {
    const harness = await createHarness()
    harness.source.set({
      s1: { running: true, completionUnread: false, pendingInteraction: approval() },
    })
    harness.stop()

    await vi.advanceTimersByTimeAsync(PENDING_DELAY_MS)
    expect(harness.sender.sent).toHaveLength(0)
  })

  it("sends a test push to one subscription", async () => {
    const harness = await createHarness()

    const result = await harness.dispatcher.sendTest(APPROVAL)

    expect(result).toBe("sent")
    expect(harness.sender.sent).toHaveLength(1)
    const sent = harness.sender.sent[0]
    if (sent === undefined) throw new Error("no push was sent")
    expect(sent.subscription.endpoint).toBe(APPROVAL)
    expect(sent.message.title).toBe("Test notification")
    expect(sent.options).toEqual({
      ttlSeconds: 300,
      urgency: "normal",
      topic: topicOf("dsh-notify:test"),
    })
  })

  it("reports a test push to an unknown subscription", async () => {
    const harness = await createHarness()
    const result = await harness.dispatcher.sendTest("https://push.example.com/gone")

    expect(result).toEqual({ failed: { status: 0, message: expect.any(String) } })
    expect(harness.sender.sent).toHaveLength(0)
  })

  it("deletes the subscription when the test push reports gone", async () => {
    const harness = await createHarness()
    harness.sender.fallback = "gone"

    expect(await harness.dispatcher.sendTest(APPROVAL)).toBe("gone")
    expect(await harness.store.get(APPROVAL)).toBeUndefined()
  })
})
