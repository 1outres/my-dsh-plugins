import type { Context } from "@deepseek-ai/cordis"
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol"
import type { NotifyPushApi } from "./push/control"
import { type SubscriptionInput, validateSubscription } from "./push/subscription"

/**
 * The API object is kept off the public surface. The Gateway calls Remote
 * methods with a Cordis service proxy as `this`, where a JS private field would
 * throw, so the field is symbol-keyed instead.
 */
const API = Symbol("notifyPushApi")

/**
 * Browser bridge for Web Push. It only moves subscription facts and presence
 * between one browser and the Host; encryption and sending stay on the Host.
 */
export class NotifyPushService extends TypertRemoteService {
  [API]: NotifyPushApi

  constructor(ctx: Context, api: NotifyPushApi) {
    super(ctx, "notifyPush")
    this[API] = api
  }

  @Remote
  async publicKey(): Promise<{ publicKey: string }> {
    return { publicKey: await this[API].publicKey() }
  }

  @Remote
  async subscribe(subscription: SubscriptionInput): Promise<{ id: string }> {
    validateSubscription(subscription)
    return { id: await this[API].subscribe(subscription) }
  }

  @Remote
  async unsubscribe(endpoint: string): Promise<{ removed: boolean }> {
    return { removed: await this[API].unsubscribe(endpoint) }
  }

  @Remote
  async presence(endpoint: string, visible: boolean, focused: boolean): Promise<{ ok: true }> {
    this[API].presence(endpoint, visible, focused)
    return { ok: true }
  }

  @Remote
  async status(endpoint: string): Promise<{ subscribed: boolean }> {
    return { subscribed: await this[API].status(endpoint) }
  }

  @Remote
  async test(endpoint: string): Promise<{ result: "sent" | "gone" | "failed" }> {
    return { result: await this[API].test(endpoint) }
  }
}
