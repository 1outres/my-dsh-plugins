import z from "@deepseek-ai/schemastery"
import type { PluginSettings } from "./contract"

// Node fires a timer longer than 2^31 - 1 milliseconds at once.
const MAX_TIMER_SECONDS = 2_147_483

/** Plugin settings. Every field is volatile, so a change applies to the next call. */
export const Config = z.object({
  command: z
    .string()
    .pattern(/\S/)
    .default("claude")
    .description("Name or absolute path of the Claude Code executable.")
    .volatile(),
  claudeConfigDir: z
    .string()
    .default("")
    .description("Claude Code config directory. Empty means the CLI's own default lookup.")
    .volatile(),
  claudeCodeTelemetry: z
    .boolean()
    .default(true)
    .description("Let Claude Code send telemetry and fetch feature flags. Flags unlock models.")
    .volatile(),
  readIdleTimeoutSeconds: z
    .number()
    .min(1)
    .max(MAX_TIMER_SECONDS)
    .default(1800)
    .description("Seconds of silence from Claude Code before a call fails.")
    .volatile(),
})

export type ParsedConfig = { [Key in keyof PluginSettings]: { get(): PluginSettings[Key] } }

export function readSettings(config: ParsedConfig): PluginSettings {
  return {
    command: config.command.get(),
    claudeConfigDir: config.claudeConfigDir.get(),
    claudeCodeTelemetry: config.claudeCodeTelemetry.get(),
    readIdleTimeoutSeconds: config.readIdleTimeoutSeconds.get(),
  }
}
