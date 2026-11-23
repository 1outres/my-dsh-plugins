import z from "@deepseek-ai/schemastery"
import type { AdvisorConfig, AdvisorRoute, AdvisorSettings } from "./contract"
import { AdvisorError } from "./host/errors"
import { ADVICE_WORD_LIMIT_RULE, ADVISOR_DEFAULTS, TIMEOUT_MS_RULE } from "./shared/settings"

export const Config = z.object({
  provider: z
    .string()
    .default(ADVISOR_DEFAULTS.provider)
    .description(
      "Provider id of the advisor model, as listed in Settings > Models. Leave provider and model empty to turn the advisor off.",
    )
    .volatile(),
  model: z
    .string()
    .default(ADVISOR_DEFAULTS.model)
    .description("Model id of the advisor model within that provider.")
    .volatile(),
  reasoningEffort: z
    .string()
    .default(ADVISOR_DEFAULTS.reasoningEffort)
    .description("Reasoning effort id for the advisor model. Leave empty for the model default.")
    .volatile(),
  adviceWordLimit: z
    .natural()
    .min(ADVICE_WORD_LIMIT_RULE.min)
    .max(ADVICE_WORD_LIMIT_RULE.max)
    .default(ADVISOR_DEFAULTS.adviceWordLimit)
    .description("The advisor is asked to keep each piece of advice under this many words.")
    .volatile(),
  timeoutMs: z
    .natural()
    .role("ms")
    .min(TIMEOUT_MS_RULE.min)
    .default(ADVISOR_DEFAULTS.timeoutMs)
    .description("Milliseconds one advisor call may take before it fails.")
    .volatile(),
})

export function isAdvisorConfigured(config: AdvisorConfig): boolean {
  return config.provider.get().trim() !== "" || config.model.get().trim() !== ""
}

export function readAdvisorSettings(config: AdvisorConfig): AdvisorSettings {
  return {
    route: readRoute(config),
    adviceWordLimit: config.adviceWordLimit.get(),
    timeoutMs: config.timeoutMs.get(),
  }
}

function readRoute(config: AdvisorConfig): AdvisorRoute {
  const provider = config.provider.get().trim()
  const model = config.model.get().trim()
  if (provider === "" || model === "") {
    throw new AdvisorError(
      "invalid_config",
      "set both the provider and the model of the advisor in the Advisor plugin settings",
    )
  }
  const reasoningEffort = config.reasoningEffort.get().trim()
  return reasoningEffort === "" ? { provider, model } : { provider, model, reasoningEffort }
}
