import { ADVISOR_DEFAULTS, LIMIT_RULES, type LimitField } from "../shared/settings"
import type { AdvisorFormValues } from "./types"

type TextField = "provider" | "model" | "reasoningEffort"

function stringField(section: Record<string, unknown>, field: TextField): string {
  const value = section[field]
  return typeof value === "string" ? value : ADVISOR_DEFAULTS[field]
}

function numberField(section: Record<string, unknown>, field: LimitField): number {
  const value = section[field]
  return typeof value === "number" && Number.isFinite(value) ? value : ADVISOR_DEFAULTS[field]
}

export function readFormValues(value: unknown): AdvisorFormValues {
  const section =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
  return {
    provider: stringField(section, "provider"),
    model: stringField(section, "model"),
    reasoningEffort: stringField(section, "reasoningEffort"),
    adviceWordLimit: numberField(section, "adviceWordLimit"),
    timeoutMs: numberField(section, "timeoutMs"),
  }
}

export function parseLimit(field: LimitField, text: string): number | undefined {
  const trimmed = text.trim()
  if (!/^\d+$/u.test(trimmed)) return undefined
  const value = Number(trimmed)
  const rule = LIMIT_RULES[field]
  if (value < rule.min) return undefined
  if (rule.max !== undefined && value > rule.max) return undefined
  return value
}
