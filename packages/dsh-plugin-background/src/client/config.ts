import type { BackgroundConfig } from "./types"

/**
 * The profile entry id in the bundle patch. It is also the settings namespace
 * the browser half reads, so the two halves must agree on it.
 */
export const CONFIG_NAMESPACE = "background"

/** Shown when a field was never written (schema defaults live in the host half). */
export const DEFAULT_CONFIG: BackgroundConfig = {
  enabled: true,
  image: "",
  panelOpacity: 70,
  dim: 30,
  blur: 0,
}

/** Alias tokens turned translucent so the image shows through the interface. */
export const TOKEN_NAMES = [
  "--dsw-alias-bg-base",
  "--dsw-alias-bg-layer-1",
  "--dsw-alias-bg-layer-2",
  "--dsw-alias-bg-layer-3",
  "--dsw-alias-bg-layer-4",
  "--dsw-alias-bg-overlay",
  "--dsw-specific-sidebar-fill",
] as const

/** Coerce one Host section into the shape the browser half expects. */
export function normalizeConfig(value: Partial<BackgroundConfig> | undefined): BackgroundConfig {
  return {
    enabled: typeof value?.enabled === "boolean" ? value.enabled : DEFAULT_CONFIG.enabled,
    image: typeof value?.image === "string" ? value.image : DEFAULT_CONFIG.image,
    panelOpacity:
      typeof value?.panelOpacity === "number" ? value.panelOpacity : DEFAULT_CONFIG.panelOpacity,
    dim: typeof value?.dim === "number" ? value.dim : DEFAULT_CONFIG.dim,
    blur: typeof value?.blur === "number" ? value.blur : DEFAULT_CONFIG.blur,
  }
}
