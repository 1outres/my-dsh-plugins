import { diffStatus, formatNotice } from "../shared/notify"
import { OPEN_SESSION_PARAM, type PwaPushMessage } from "../shared/protocol"
import type { NoticeEvent, NotifyConfig, SessionStatusMap } from "../shared/types"
import type { PresenceLike } from "./push/presence"
import { type PushSender, type PushSendResult, topicOf } from "./push/sender"
import { type PushSubscriptionStore, subscriptionId } from "./push/store"
import type { LoggerLike } from "./types"
import type { SessionStatusSource } from "./watch"

/** Automatic answerers settle most requests at once, so wait before pushing. */
export const PENDING_DELAY_MS = 1500
/** Undelivered pending interactions stay relevant for a while. */
export const PENDING_TTL_SECONDS = 3600
/** A finished turn is stale soon; do not wake a phone for an old one. */
export const COMPLETION_TTL_SECONDS = 300
const TEST_TTL_SECONDS = 300

const TEST_MESSAGE: PwaPushMessage = {
  dshPwa: 1,
  title: "Test notification",
  options: {
    body: "Push notifications reach this device.",
    tag: "dsh-notify:test",
    data: { dshPwa: 1 },
  },
}

export interface NotificationDispatcherOptions {
  readonly watcher: SessionStatusSource
  readonly store: PushSubscriptionStore
  readonly presence: PresenceLike
  readonly sender: PushSender
  readonly config: () => NotifyConfig
  readonly logger: LoggerLike
  readonly now?: () => number
}

/**
 * Turns watcher status changes into Web Push messages. The gates read the
 * live config on every decision, because volatile settings change without a
 * restart. Pending interactions wait for a short delay so an automatic
 * answerer can settle them first.
 */
export class NotificationDispatcher {
  readonly #watcher: SessionStatusSource
  readonly #store: PushSubscriptionStore
  readonly #presence: PresenceLike
  readonly #sender: PushSender
  readonly #config: () => NotifyConfig
  readonly #logger: LoggerLike
  readonly #now: () => number
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>()
  readonly #warned = new Set<string>()
  #previous: SessionStatusMap | undefined

  constructor(options: NotificationDispatcherOptions) {
    this.#watcher = options.watcher
    this.#store = options.store
    this.#presence = options.presence
    this.#sender = options.sender
    this.#config = options.config
    this.#logger = options.logger
    this.#now = options.now ?? Date.now
  }

  start(): () => void {
    const unsubscribe = this.#watcher.subscribe(() => this.#sync())
    this.#sync()
    return () => {
      unsubscribe()
      for (const timer of this.#timers.values()) clearTimeout(timer)
      this.#timers.clear()
    }
  }

  /** Send one test push to a subscription, if this Host still has it. */
  async sendTest(endpoint: string): Promise<PushSendResult> {
    const subscription = await this.#store.get(endpoint)
    if (subscription === undefined) {
      return { failed: { status: 0, message: "This device is not subscribed" } }
    }
    const result = await this.#sender.send(subscription, TEST_MESSAGE, {
      ttlSeconds: TEST_TTL_SECONDS,
      urgency: "normal",
      topic: topicOf("dsh-notify:test"),
    })
    if (result === "gone") await this.#store.delete(endpoint)
    return result
  }

  #sync(): void {
    const config = this.#config()
    const next = this.#watcher.getSnapshot()
    const diff = diffStatus(this.#previous, next, {
      approval: config.approval,
      question: config.question,
      completion: config.completion,
    })
    this.#previous = next
    if (!config.enabled || !config.push) return
    for (const event of diff.opened) this.#schedule(event)
  }

  #schedule(event: NoticeEvent): void {
    if (event.kind === "completion") {
      void this.#deliver(event).catch((error) => this.#warnFailure(event.sessionId, error))
      return
    }
    const timerKey = `${event.sessionId}:${event.key}`
    const existing = this.#timers.get(timerKey)
    if (existing !== undefined) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.#timers.delete(timerKey)
      if (!this.#isPending(event)) return
      void this.#deliver(event).catch((error) => this.#warnFailure(event.sessionId, error))
    }, PENDING_DELAY_MS)
    this.#timers.set(timerKey, timer)
  }

  #isPending(event: NoticeEvent): boolean {
    return this.#watcher.getSnapshot().get(event.sessionId)?.pendingInteraction?.key === event.key
  }

  async #deliver(event: NoticeEvent): Promise<void> {
    const config = this.#config()
    if (!config.enabled || !config.push) return
    const spec = formatNotice(event, this.#watcher.titleOf(event.sessionId), {
      showDetail: config.showDetail,
    })
    const message: PwaPushMessage = {
      dshPwa: 1,
      title: spec.title,
      options: {
        body: spec.body,
        tag: spec.tag,
        renotify: event.kind !== "completion",
        data: {
          dshPwa: 1,
          openUrl: `./?${OPEN_SESSION_PARAM}=${encodeURIComponent(event.sessionId)}`,
          payload: { sessionId: event.sessionId },
        },
      },
    }
    const subscriptions = await this.#store.list()
    for (const subscription of subscriptions) {
      if (
        config.onlyWhenUnfocused &&
        this.#presence.isAttended(subscription.endpoint, this.#now())
      ) {
        continue
      }
      let result: PushSendResult
      try {
        result = await this.#sender.send(subscription, message, {
          ttlSeconds: event.kind === "completion" ? COMPLETION_TTL_SECONDS : PENDING_TTL_SECONDS,
          urgency: event.kind === "completion" ? "normal" : "high",
          topic: topicOf(spec.tag),
        })
      } catch (error) {
        this.#warnOnce(subscription.endpoint, {
          status: 0,
          message: error instanceof Error ? error.message : String(error),
        })
        continue
      }
      if (result === "gone") {
        await this.#store.delete(subscription.endpoint)
        continue
      }
      if (typeof result === "object") {
        this.#warnOnce(subscription.endpoint, result.failed)
      }
    }
  }

  #warnOnce(
    endpoint: string,
    failure: { readonly status: number; readonly message: string },
  ): void {
    const key = `${subscriptionId(endpoint)}:${failure.status}`
    if (this.#warned.has(key)) return
    this.#warned.add(key)
    this.#logger.warn(
      `notify: push to ${new URL(endpoint).origin} failed (${failure.status}): ${failure.message}`,
    )
  }

  #warnFailure(sessionId: string, error: unknown): void {
    this.#logger.warn(
      `notify: could not send a push for ${sessionId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}
