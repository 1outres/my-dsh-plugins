import z from "@deepseek-ai/schemastery"
import type { PresetId } from "./contract"

export interface Config {
  presets: string[]
  exitCode: number
  resumeWithinMinutes: number
  forceExitAfterMs: number
}

export const Config = z.object({
  presets: z
    .array(z.string())
    .default(["cordis", "creator-ptc"])
    .description("Agent preset ids that count as Creator mode."),
  exitCode: z
    .number()
    .step(1)
    .min(1)
    .max(255)
    .default(75)
    .description("Exit code that asks the service supervisor to start DeepSeek Harness again."),
  resumeWithinMinutes: z
    .number()
    .step(1)
    .min(1)
    .default(10)
    .description("Minutes after which a stored resume request is dropped instead of resumed."),
  forceExitAfterMs: z
    .number()
    .step(1)
    .min(1)
    .default(15000)
    .description("Milliseconds before the process is ended when the normal shutdown hangs."),
})

export interface ResolvedConfig {
  readonly presets: readonly PresetId[]
  readonly exitCode: number
  readonly resumeWithinMinutes: number
  readonly forceExitAfterMs: number
}

export function resolveConfig(config: Config): ResolvedConfig {
  if (
    !Array.isArray(config.presets) ||
    config.presets.length === 0 ||
    config.presets.some((preset) => typeof preset !== "string" || preset.trim() === "")
  ) {
    throw new Error("restart: presets must be a non-empty array of preset ids")
  }
  if (!Number.isInteger(config.exitCode) || config.exitCode < 1 || config.exitCode > 255) {
    throw new Error("restart: exitCode must be an integer from 1 to 255")
  }
  if (!Number.isInteger(config.resumeWithinMinutes) || config.resumeWithinMinutes < 1) {
    throw new Error("restart: resumeWithinMinutes must be a positive integer")
  }
  if (!Number.isInteger(config.forceExitAfterMs) || config.forceExitAfterMs < 1) {
    throw new Error("restart: forceExitAfterMs must be a positive integer")
  }
  return {
    presets: [...config.presets],
    exitCode: config.exitCode,
    resumeWithinMinutes: config.resumeWithinMinutes,
    forceExitAfterMs: config.forceExitAfterMs,
  }
}
