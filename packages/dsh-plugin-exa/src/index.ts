import type { Context } from "@deepseek-ai/cordis"
import type {} from "@deepseek-ai/dsh-credentials"
import type {} from "@deepseek-ai/dsh-web"
import z from "@deepseek-ai/schemastery"
import type { ExaConfig, ExaOptions } from "./contract"
import { snapshotOptions } from "./host/options"
import { createFetchProvider, createSearchProvider, type ProviderPorts } from "./host/providers"

export const name = "exa"

/** The web seam the providers register into, and the credential store they read. */
export const inject = ["web", "credentials"]

/**
 * Settings. Every field is volatile so a Settings change applies to the next
 * search or fetch without restarting the Host plugin.
 */
export const Config = z.object({
  apiKeyEnv: z
    .string()
    .pattern(/^[A-Za-z_][A-Za-z0-9_]*$/u)
    .default("EXA_API_KEY")
    .description("Name of the credential that holds the Exa API key.")
    .volatile(),
  baseURL: z
    .string()
    .default("https://api.exa.ai")
    .description("Exa API base URL. The provider appends /search or /contents.")
    .volatile(),
  searchType: z
    .union(["auto", "lite", "deep-lite", "deep"] as const)
    .default("auto")
    .description("Search mode: auto, lite, deep-lite, or deep.")
    .volatile(),
  searchContents: z
    .union(["highlights", "text"] as const)
    .default("highlights")
    .description("What to return for each result: highlights or full text.")
    .volatile(),
  searchMaxCharacters: z
    .number()
    .step(1)
    .min(100)
    .max(20000)
    .default(1000)
    .description("Characters of highlights or text kept per search result.")
    .volatile(),
  includeDomains: z
    .array(z.string())
    .default([])
    .description("Only return results from these domains. Empty means no filter.")
    .volatile(),
  excludeDomains: z
    .array(z.string())
    .default([])
    .description("Drop results from these domains. Empty means no filter.")
    .volatile(),
  fetchMaxCharacters: z
    .number()
    .step(1)
    .min(1000)
    .max(1000000)
    .default(100000)
    .description("Characters kept from a fetched page before it is marked truncated.")
    .volatile(),
})

interface SettingsLike {
  configure(presentation: { auto?: boolean }, owner?: unknown): () => void
}

/**
 * Host half: registers Exa as the search and fetch provider, and tells
 * Settings that this plugin ships its own page instead of a generated form.
 * @param ctx - Host context.
 * @param config - live settings, read once per operation.
 */
export function apply(ctx: Context, config: ExaConfig): void {
  const ports: ProviderPorts = {
    credentials: ctx.credentials,
    logger: { warn: (message) => ctx.logger.warn(`exa: ${message}`) },
    fetch: (input, init) => globalThis.fetch(input, init),
    options: (): ExaOptions => snapshotOptions(config),
  }

  ctx.web.registerSearchProvider(createSearchProvider(ports))
  ctx.web.registerFetchProvider(createFetchProvider(ports))

  ctx.inject(["settings"], (child) => {
    const settings = (child as Context & { settings: SettingsLike }).settings
    child.effect(() => settings.configure({ auto: false }, ctx.fiber), "exa: settings page policy")
  })
}
