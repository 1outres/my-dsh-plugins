import type { Context } from "@deepseek-ai/cordis"
import type { NotifyConfig } from "../../shared/types"
import type { HostPushConfig } from "../config"
import { NotificationDispatcher } from "../dispatcher"
import { NotifyPushService } from "../remote"
import type { LoggerLike } from "../types"
import { SessionStatusWatcher, type WatcherContext } from "../watch"
import { PushControl } from "./control"
import { Presence } from "./presence"
import { createPushSender } from "./sender"
import { DomainPushStore, PUSH_DOMAIN, type StorageDomainLike } from "./store"

/** The Host services the push part needs. */
export interface PushHostContext extends WatcherContext {
  readonly storageDomain: StorageDomainLike
  readonly logger: LoggerLike
  effect(effect: () => (() => void) | undefined, label?: string): void
}

/**
 * Start the Host push stack: one storage domain, the watcher, the dispatcher,
 * and the Remote service. The caller provides a context that has
 * `storageDomain`, `sessions`, and `sessionTitle`.
 */
export async function installPush(ctx: Context, config: HostPushConfig): Promise<void> {
  const host = ctx as unknown as PushHostContext
  const store = new DomainPushStore(await host.storageDomain.open(PUSH_DOMAIN))
  const presence = new Presence()
  const sender = createPushSender({
    fetch: (input, init) =>
      fetch(input, {
        method: init.method,
        headers: init.headers,
        body: new Uint8Array(init.body),
      }),
    vapid: () => store.vapid(),
    subject: () => config.vapidSubject,
  })
  const watcher = new SessionStatusWatcher(
    {
      sessions: host.sessions,
      sessionTitle: host.sessionTitle,
      on: host.on,
    },
    { now: Date.now },
  )
  const dispatcher = new NotificationDispatcher({
    watcher,
    store,
    presence,
    sender,
    config: () => liveConfig(config),
    logger: host.logger,
  })
  const control = new PushControl({
    store,
    presence,
    sendTest: (endpoint) => dispatcher.sendTest(endpoint),
  })
  new NotifyPushService(ctx, control)

  host.effect(() => watcher.attach(), "notify: session status")
  host.effect(() => dispatcher.start(), "notify: push dispatcher")
  host.effect(() => () => store.close(), "notify: push store")
}
/** Read every volatile switch now, so a Settings change applies at once. */
function liveConfig(config: HostPushConfig): NotifyConfig {
  return {
    enabled: config.enabled.get(),
    onlyWhenUnfocused: config.onlyWhenUnfocused.get(),
    approval: config.approval.get(),
    question: config.question.get(),
    completion: config.completion.get(),
    showDetail: config.showDetail.get(),
    push: config.push.get(),
  }
}
