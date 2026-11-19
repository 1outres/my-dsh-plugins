import type { JsonObject, NativeDeps } from "../contract"
import { FailureCode, NativeFailure } from "../errors"
import { assertNoBackendOverride, probeEnv } from "../native/env"
import { resolveClaude } from "../native/executable"
import { stderrSuffix, throwIfAborted } from "../native/failures"
import { type ProbeOutput, runProbe, withProbeDirectory } from "../native/probe"
import type { UsageExtraUsage, UsageLimit, UsageLimitScope, UsageReport } from "./contract"

export const USAGE_REPORT_TIMEOUT_MS = 30_000

export const USAGE_ARGS = [
  "-p",
  "--output-format",
  "stream-json",
  "--verbose",
  "--tools",
  "",
  "--setting-sources",
  "",
  "--strict-mcp-config",
  "--mcp-config",
  '{"mcpServers":{}}',
  "--no-session-persistence",
  "/usage",
] as const

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function malformed(what: string, output: ProbeOutput, cause?: unknown): NativeFailure {
  return new NativeFailure(
    `Could not read the /usage report: ${what}${stderrSuffix(output.stderr)}`,
    FailureCode.nativeProtocol,
    cause === undefined ? {} : { cause },
  )
}

function requiredObject(value: unknown, what: string, output: ProbeOutput): JsonObject {
  if (isObject(value)) return value
  throw malformed(`${what} is missing`, output)
}

function requiredArray(value: unknown, what: string, output: ProbeOutput): readonly unknown[] {
  if (Array.isArray(value)) return value
  throw malformed(`${what} is missing`, output)
}

function requiredString(value: unknown, what: string, output: ProbeOutput): string {
  if (typeof value === "string" && value !== "") return value
  throw malformed(`${what} is not a string`, output)
}

function nullableString(value: unknown, what: string, output: ProbeOutput): string | null {
  if (value === null) return null
  return requiredString(value, what, output)
}

function numberOf(value: unknown, what: string, output: ProbeOutput): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  throw malformed(`${what} is not a finite number`, output)
}

function nullableNumber(value: unknown, what: string, output: ProbeOutput): number | null {
  if (value === null) return null
  return numberOf(value, what, output)
}

function booleanOf(value: unknown, what: string, output: ProbeOutput): boolean {
  if (typeof value === "boolean") return value
  throw malformed(`${what} is not a boolean`, output)
}

function timeOf(value: unknown, what: string, output: ProbeOutput): number | null {
  const text = nullableString(value, what, output)
  if (text === null) return null
  const time = Date.parse(text)
  if (!Number.isFinite(time)) throw malformed(`${what} is not an ISO 8601 time`, output)
  return time
}

function scopeNameOf(value: unknown, what: string, output: ProbeOutput) {
  if (value === null) return null
  const name = requiredObject(value, what, output)
  return { displayName: requiredString(name.display_name, `${what}.display_name`, output) }
}

function scopeOf(value: unknown, output: ProbeOutput): UsageLimitScope | null {
  if (value === null) return null
  const scope = requiredObject(value, "scope", output)
  if (!("model" in scope) || !("surface" in scope)) {
    throw malformed("scope must hold model and surface", output)
  }
  return {
    model: scopeNameOf(scope.model, "scope.model", output),
    surface: scopeNameOf(scope.surface, "scope.surface", output),
  }
}

function limitOf(value: unknown, index: number, output: ProbeOutput): UsageLimit {
  const limit = requiredObject(value, `limits[${index}]`, output)
  return {
    kind: requiredString(limit.kind, `limits[${index}].kind`, output),
    group: requiredString(limit.group, `limits[${index}].group`, output),
    percent: numberOf(limit.percent, `limits[${index}].percent`, output),
    resetsAt: timeOf(limit.resets_at, `limits[${index}].resets_at`, output),
    scope: scopeOf(limit.scope, output),
    severity: requiredString(limit.severity, `limits[${index}].severity`, output),
    isActive: booleanOf(limit.is_active, `limits[${index}].is_active`, output),
  }
}

function extraUsageOf(value: unknown, output: ProbeOutput): UsageExtraUsage {
  const extra = requiredObject(value, "rate_limits.extra_usage", output)
  return {
    isEnabled: booleanOf(extra.is_enabled, "extra_usage.is_enabled", output),
    monthlyLimit: nullableNumber(extra.monthly_limit, "extra_usage.monthly_limit", output),
    usedCredits: nullableNumber(extra.used_credits, "extra_usage.used_credits", output),
    utilization: nullableNumber(extra.utilization, "extra_usage.utilization", output),
    currency: nullableString(extra.currency, "extra_usage.currency", output),
  }
}

function parseRows(output: ProbeOutput): JsonObject[] {
  const lines = output.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
  try {
    return lines.map((line) => JSON.parse(line) as JsonObject)
  } catch (error) {
    throw malformed("invalid JSON on stdout", output, error)
  }
}

/** Reads the one assistant row of the `/usage` command. Never guesses a missing field. */
export function parseUsageReport(output: ProbeOutput, fetchedAt: number): UsageReport {
  const row = parseRows(output).find((candidate) => candidate.type === "assistant")
  if (row === undefined) throw malformed("no assistant row", output)
  const report = requiredObject(row.usage_report, "usage_report", output)
  const rateLimits = requiredObject(report.rate_limits, "usage_report.rate_limits", output)
  const rawLimits = requiredArray(rateLimits.limits, "rate_limits.limits", output)
  return {
    fetchedAt,
    limits: rawLimits.map((limit, index) => limitOf(limit, index, output)),
    extraUsage: extraUsageOf(rateLimits.extra_usage, output),
  }
}

/**
 * Runs `claude ... /usage` and reads its report. It makes no model request. The
 * CLI must not be pointed at another backend, so the probe environment is used.
 */
export async function runUsageReport(deps: NativeDeps, signal?: AbortSignal): Promise<UsageReport> {
  throwIfAborted(signal)
  const processEnv = deps.processEnv()
  assertNoBackendOverride(processEnv)
  const executable = await resolveClaude(deps, signal)
  const output = await withProbeDirectory((cwd) =>
    runProbe(deps, {
      argv: [executable, ...USAGE_ARGS],
      stdin: "ignore",
      env: probeEnv(deps.settings(), processEnv),
      cwd,
      timeoutMs: USAGE_REPORT_TIMEOUT_MS,
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  return parseUsageReport(output, Date.now())
}
