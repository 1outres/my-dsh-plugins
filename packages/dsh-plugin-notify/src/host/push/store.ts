import { createHash } from "node:crypto"
import { z } from "zod"
import type { VapidKeys } from "./vapid"
import { generateVapidKeys } from "./vapid"

/** One stored subscription. */
export interface PushSubscription {
  readonly endpoint: string
  readonly p256dh: string
  readonly auth: string
  readonly label: string
  readonly createdAt: number
}

export interface PushGlobal {
  readonly vapid: VapidKeys | null
}

const vapidSchema = z.object({
  publicKey: z.string(),
  privateKey: z.string(),
})

const globalSchema = z.object({
  vapid: vapidSchema.nullable(),
})

const subscriptionSchema = z.object({
  endpoint: z.string(),
  p256dh: z.string(),
  auth: z.string(),
  label: z.string(),
  createdAt: z.number(),
})

/**
 * Domain declaration for `ctx.storageDomain`. It is a plain descriptor on
 * purpose: the plugin mirrors the domain contract it uses instead of reaching
 * into the storage package.
 */
export const PUSH_DOMAIN = {
  name: "notify-push",
  version: 1,
  global: { schema: globalSchema, initial: { vapid: null } as PushGlobal },
  tables: { subscriptions: { valueSchema: subscriptionSchema } },
} as const

export interface PushDomainTable {
  get(key: string): PushSubscription | undefined
  entries(): IterableIterator<[string, PushSubscription]>
  put(key: string, value: PushSubscription): Promise<void>
  delete(key: string): Promise<boolean>
}

export interface PushDomain {
  readonly global: {
    get(): PushGlobal
    set(value: PushGlobal): Promise<void>
  }
  table(name: "subscriptions"): PushDomainTable
  close(): Promise<void>
}

/** The slice of `ctx.storageDomain` this plugin uses. */
export interface StorageDomainLike {
  open(spec: typeof PUSH_DOMAIN): Promise<PushDomain>
}

/** What the sender and dispatcher read. */
export interface PushSubscriptionStore {
  list(): Promise<PushSubscription[]>
  get(endpoint: string): Promise<PushSubscription | undefined>
  delete(endpoint: string): Promise<boolean>
}

/** Persisted subscriptions plus the Host's VAPID identity. */
export interface PushStore extends PushSubscriptionStore {
  vapid(): Promise<VapidKeys>
  put(record: PushSubscription): Promise<void>
  close(): Promise<void>
}

/** Stable table key for an endpoint; push endpoints are too long for a key. */
export function subscriptionId(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("base64url")
}

/** Store backed by one `notify-push` storage domain. */
export class DomainPushStore implements PushStore {
  readonly #domain: PushDomain
  #keys: Promise<VapidKeys> | undefined

  constructor(domain: PushDomain) {
    this.#domain = domain
  }

  async vapid(): Promise<VapidKeys> {
    const stored = this.#domain.global.get().vapid
    if (stored !== null) return stored
    this.#keys ??= this.#generateKeys()
    return this.#keys
  }

  async put(record: PushSubscription): Promise<void> {
    await this.#table().put(subscriptionId(record.endpoint), record)
  }

  async get(endpoint: string): Promise<PushSubscription | undefined> {
    return this.#table().get(subscriptionId(endpoint))
  }

  async list(): Promise<PushSubscription[]> {
    return [...this.#table().entries()].map(([, record]) => record)
  }

  async delete(endpoint: string): Promise<boolean> {
    return this.#table().delete(subscriptionId(endpoint))
  }

  async close(): Promise<void> {
    await this.#domain.close()
  }

  async #generateKeys(): Promise<VapidKeys> {
    const keys = generateVapidKeys()
    await this.#domain.global.set({ vapid: keys })
    return keys
  }

  #table(): PushDomainTable {
    return this.#domain.table("subscriptions")
  }
}
