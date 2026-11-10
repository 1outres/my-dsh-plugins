import type {
  PushSender,
  PushSendOptions,
  PushSendResult,
  PushSubscription,
} from "../src/host/push/sender"
import type { PushGlobal, PushStore } from "../src/host/push/store"
import { generateVapidKeys, type VapidKeys } from "../src/host/push/vapid"
import type { PwaPushMessage } from "../src/shared/protocol"

/** In-memory store for the modules that only read subscriptions. */
export class MemoryPushStore implements PushStore {
  readonly records = new Map<string, PushSubscription>()
  keys: VapidKeys | undefined
  closed = false

  async vapid(): Promise<VapidKeys> {
    this.keys ??= generateVapidKeys()
    return this.keys
  }

  async put(record: PushSubscription): Promise<void> {
    this.records.set(record.endpoint, record)
  }

  async get(endpoint: string): Promise<PushSubscription | undefined> {
    return this.records.get(endpoint)
  }

  async list(): Promise<PushSubscription[]> {
    return [...this.records.values()]
  }

  async delete(endpoint: string): Promise<boolean> {
    return this.records.delete(endpoint)
  }

  async close(): Promise<void> {
    this.closed = true
  }
}

export interface SentPush {
  subscription: PushSubscription
  message: PwaPushMessage
  options: PushSendOptions
}

/** Sender fake that records every call and returns scripted results. */
export class FakeSender implements PushSender {
  readonly sent: SentPush[] = []
  results: PushSendResult[] = []
  fallback: PushSendResult = "sent"
  failWith: unknown

  async send(
    subscription: PushSubscription,
    message: PwaPushMessage,
    options: PushSendOptions,
  ): Promise<PushSendResult> {
    if (this.failWith !== undefined) {
      const failure = this.failWith
      this.failWith = undefined
      throw failure
    }
    this.sent.push({ subscription, message, options })
    return this.results.shift() ?? this.fallback
  }
}

export function pushSubscription(overrides: Partial<PushSubscription> = {}): PushSubscription {
  return {
    endpoint: "https://push.example.com/a",
    p256dh: "p256dh",
    auth: "auth",
    label: "Safari on iPhone",
    createdAt: 1,
    ...overrides,
  }
}

export interface FakeDomainTable {
  readonly records: Map<string, PushSubscription>
  get(key: string): PushSubscription | undefined
  entries(): IterableIterator<[string, PushSubscription]>
  put(key: string, value: PushSubscription): Promise<void>
  delete(key: string): Promise<boolean>
}

/** Minimal storage-domain handle; the real one is supplied by ctx.storageDomain. */
export class FakeDomain {
  value: PushGlobal = { vapid: null }
  readonly subscriptions: FakeDomainTable
  closed = false

  constructor() {
    const records = new Map<string, PushSubscription>()
    this.subscriptions = {
      records,
      get: (key) => records.get(key),
      entries: () => records.entries(),
      put: async (key, value) => {
        records.set(key, value)
      },
      delete: async (key) => records.delete(key),
    }
  }

  readonly global = {
    get: () => this.value,
    set: async (value: PushGlobal) => {
      this.value = value
    },
  }

  table(_name: "subscriptions"): FakeDomainTable {
    return this.subscriptions
  }

  async close(): Promise<void> {
    this.closed = true
  }
}
