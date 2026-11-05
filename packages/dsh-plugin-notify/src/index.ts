import type { Context } from "@deepseek-ai/cordis"
import z from "@deepseek-ai/schemastery"

/**
 * Settings schema. Every field is volatile so the Settings form can edit it
 * through the profile patch; the browser half reads the same projected values
 * through `configForms`.
 */
export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  onlyWhenUnfocused: z.boolean().default(true).volatile(),
  approval: z.boolean().default(true).volatile(),
  question: z.boolean().default(true).volatile(),
  completion: z.boolean().default(true).volatile(),
  showDetail: z.boolean().default(true).volatile(),
})

interface SettingsLike {
  configure(presentation: { auto?: boolean }, owner?: unknown): () => void
}

/**
 * Host half. It owns no runtime behavior: notifications are raised by the
 * browser that is looking at the Session, and the Host cannot know whether that
 * window is visible. This half only tells Settings that the plugin ships its own
 * page instead of the schema-generated one.
 */
export function apply(ctx: Context): void {
  ctx.inject(["settings"], (child) => {
    const settings = (child as Context & { settings: SettingsLike }).settings
    child.effect(
      () => settings.configure({ auto: false }, ctx.fiber),
      "notify: settings page policy",
    )
  })
}
