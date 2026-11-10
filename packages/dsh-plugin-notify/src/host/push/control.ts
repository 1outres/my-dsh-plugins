import type { Presence } from "./presence"
import type { PushSendResult } from "./sender"
import { type PushStore, subscriptionId } from "./store"
import type { SubscriptionInput } from "./subscription"

export type PushTestResult = "sent" | "gone" | "failed"

/** The Host operations the Remote service exposes. */
export interface NotifyPushApi {
  publicKey(): Promise<string>
  subscribe(input: SubscriptionInput): Promise<string>
  unsubscribe(endpoint: string): Promise<boolean>
  presence(endpoint: string, visible: boolean, focused: boolean): void
  status(endpoint: string): Promise<boolean>
  test(endpoint: string): Promise<PushTestResult>
}

export interface PushControlOptions {
  readonly store: PushStore
  readonly presence: Presence
  readonly sendTest: (endpoint: string) => Promise<PushSendResult>
  readonly now?: () => number
}

/** Subscriptions, presence, and the test push, without any Typert details. */
export class PushControl implements NotifyPushApi {
  readonly #store: PushStore
  readonly #presence: Presence
  readonly #sendTest: (endpoint: string) => Promise<PushSendResult>
  readonly #now: () => number

  constructor(options: PushControlOptions) {
    this.#store = options.store
    this.#presence = options.presence
    this.#sendTest = options.sendTest
    this.#now = options.now ?? Date.now
  }

  async publicKey(): Promise<string> {
    return (await this.#store.vapid()).publicKey
  }

  async subscribe(input: SubscriptionInput): Promise<string> {
    await this.#store.put({
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      label: input.label,
      createdAt: this.#now(),
    })
    return subscriptionId(input.endpoint)
  }

  async unsubscribe(endpoint: string): Promise<boolean> {
    this.#presence.forget(endpoint)
    return this.#store.delete(endpoint)
  }

  presence(endpoint: string, visible: boolean, focused: boolean): void {
    this.#presence.report(endpoint, { visible, focused }, this.#now())
  }

  async status(endpoint: string): Promise<boolean> {
    return (await this.#store.get(endpoint)) !== undefined
  }

  async test(endpoint: string): Promise<PushTestResult> {
    const result = await this.#sendTest(endpoint)
    if (result === "sent" || result === "gone") return result
    return "failed"
  }
}
