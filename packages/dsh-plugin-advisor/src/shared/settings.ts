export const ADVISOR_NAMESPACE = "advisor"

export interface AdvisorSettingValues {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort: string
  readonly adviceWordLimit: number
  readonly timeoutMs: number
}

export const ADVISOR_DEFAULTS: AdvisorSettingValues = {
  provider: "",
  model: "",
  reasoningEffort: "",
  adviceWordLimit: 150,
  timeoutMs: 300000,
}

export type LimitField = "adviceWordLimit" | "timeoutMs"

export interface LimitRule {
  readonly min: number
  readonly max?: number
}

export const ADVICE_WORD_LIMIT_RULE = { min: 20, max: 2000 } as const

export const TIMEOUT_MS_RULE = { min: 1000 } as const

export const LIMIT_RULES: Readonly<Record<LimitField, LimitRule>> = {
  adviceWordLimit: ADVICE_WORD_LIMIT_RULE,
  timeoutMs: TIMEOUT_MS_RULE,
}
