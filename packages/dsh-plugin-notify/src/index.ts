import type { Context } from "@deepseek-ai/cordis"
import { Config, type HostPushConfig } from "./host/config"
import { installPush } from "./host/push/install"

export const name = "notify"

export { Config }

interface SettingsLike {
  configure(presentation: { auto?: boolean }, owner?: unknown): () => void
}

/**
 * Host half. It owns the Settings page policy and the Web Push stack: VAPID
 * keys, subscriptions, the Session watcher, and the push dispatcher. The two
 * parts are separate injects so a composition without storage keeps the
 * settings page working.
 */
export function apply(ctx: Context, config: HostPushConfig): void {
  ctx.inject(["settings"], (child) => {
    const settings = (child as Context & { settings: SettingsLike }).settings
    child.effect(
      () => settings.configure({ auto: false }, ctx.fiber),
      "notify: settings page policy",
    )
  })

  ctx.inject(["sessions", "sessionTitle", "storageDomain"], (child) => {
    void installPush(child, config).catch((error: unknown) => {
      child.logger.warn(
        `notify: push is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
  })
}
