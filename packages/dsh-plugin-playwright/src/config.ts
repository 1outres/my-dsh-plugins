import z from "@deepseek-ai/schemastery"

export interface Config {
  executablePath: string
  headless: boolean
  launchArgs: string[]
  maxOutputBytes: number
  toolCallTimeoutMs: number
}

export const Config = z.object({
  executablePath: z
    .string()
    .default("")
    .description("Path to the Chromium or Chrome binary that Playwright launches."),
  headless: z.boolean().default(true).description("Run the browser without a window."),
  launchArgs: z.array(z.string()).default([]).description("Extra arguments passed to the browser."),
  maxOutputBytes: z
    .number()
    .step(1)
    .min(1024)
    .default(30000)
    .description("Bytes of text kept in one tool result."),
  toolCallTimeoutMs: z
    .number()
    .step(1)
    .min(1000)
    .default(120000)
    .description("Milliseconds before one browser tool call is stopped."),
})

export interface ResolvedConfig {
  readonly executablePath: string
  readonly headless: boolean
  readonly launchArgs: readonly string[]
  readonly maxOutputBytes: number
  readonly toolCallTimeoutMs: number
}

export function resolveConfig(config: Config): ResolvedConfig {
  if (config.executablePath.trim() === "") {
    throw new Error(
      "playwright: executablePath is required. Set it to the Chromium or Chrome binary; the plugin does not guess a browser.",
    )
  }
  if (typeof config.headless !== "boolean") {
    throw new Error("playwright: headless must be true or false")
  }
  if (
    !Array.isArray(config.launchArgs) ||
    config.launchArgs.some((arg) => typeof arg !== "string")
  ) {
    throw new Error("playwright: launchArgs must be an array of strings")
  }
  if (!Number.isInteger(config.maxOutputBytes) || config.maxOutputBytes < 1024) {
    throw new Error("playwright: maxOutputBytes must be an integer of at least 1024")
  }
  if (!Number.isInteger(config.toolCallTimeoutMs) || config.toolCallTimeoutMs < 1000) {
    throw new Error("playwright: toolCallTimeoutMs must be an integer of at least 1000")
  }
  return {
    executablePath: config.executablePath,
    headless: config.headless,
    launchArgs: [...config.launchArgs],
    maxOutputBytes: config.maxOutputBytes,
    toolCallTimeoutMs: config.toolCallTimeoutMs,
  }
}
