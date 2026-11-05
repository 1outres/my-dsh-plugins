import type { Context } from "@deepseek-ai/cordis"
import z from "@deepseek-ai/schemastery"

/**
 * Settings schema. Every field is volatile so the Settings form can edit it
 * through the profile patch; the browser half reads the same projected values
 * through `configForms`.
 */
export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  image: z.string().default("").volatile(),
  panelOpacity: z.number().min(0).max(100).step(1).default(70).volatile(),
  dim: z.number().min(0).max(100).step(1).default(30).volatile(),
  blur: z.number().min(0).max(40).step(1).default(0).volatile(),
})

interface SettingsLike {
  configure(presentation: { auto?: boolean }, owner?: unknown): () => void
}

/**
 * Host half. It owns no runtime behavior: the browser half paints the
 * background, and this half only tells Settings that the plugin ships its own
 * page instead of the schema-generated one.
 */
export function apply(ctx: Context): void {
  ctx.inject(["settings"], (child) => {
    const settings = (child as Context & { settings: SettingsLike }).settings
    child.effect(
      () => settings.configure({ auto: false }, ctx.fiber),
      "background: settings page policy",
    )
  })
}
