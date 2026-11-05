import type { Context } from "@deepseek-ai/cordis"
import z from "@deepseek-ai/schemastery"

/** One provider/model pair. Ids may contain `/`, so the pair is never joined. */
const ModelRef = z.object({
  provider: z.string(),
  model: z.string(),
})

/**
 * Settings schema. The field is volatile so the browser half can write it
 * through the profile patch with `configForms`; the picker's star buttons are
 * the only editor.
 */
export const Config = z.object({
  favorites: z
    .array(ModelRef)
    .default([])
    .description("Favorite models, shown first in the composer model picker.")
    .volatile(),
})

interface SettingsLike {
  configure(presentation: { auto?: boolean }, owner?: unknown): () => void
}

/**
 * Host half. It owns no runtime behavior: the browser half renders the picker
 * and edits `favorites` from it. This half declares the schema and tells
 * Settings not to generate a page for it.
 */
export function apply(ctx: Context): void {
  ctx.inject(["settings"], (child) => {
    const settings = (child as Context & { settings: SettingsLike }).settings
    child.effect(
      () => settings.configure({ auto: false }, ctx.fiber),
      "model-picker: settings page policy",
    )
  })
}
