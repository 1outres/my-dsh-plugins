import { homedir } from "node:os"
import type { Context } from "@deepseek-ai/cordis"
import z from "@deepseek-ai/schemastery"
import type { ClockPort, LoggerPort, TimerPort, WorkspaceRegistryPort } from "./contract"
import { nodeFs } from "./host/fs"
import { DEFAULT_ROOT, resolveRoot } from "./host/paths"
import { registerDailyWorkspace } from "./host/register"
import { startDailySchedule } from "./host/schedule"

export const name = "daily-workspace"

/** The Workspace registry, the only Host service this plugin reads. */
export const inject = ["workspaceRegistry"]

/** Settings. Changing the root restarts the Host half. */
export const Config = z.object({
  root: z
    .string()
    .default(DEFAULT_ROOT)
    .description("Directory that holds the day folders. A leading ~ is your home directory."),
})

export interface DailyWorkspaceConfig {
  root: string
}

interface HostServices {
  readonly workspaceRegistry: WorkspaceRegistryPort
}

/**
 * Host half: creates `<root>/YYYY/MM/DD` for today and registers the year,
 * the month, and the day folder as Workspaces, again at every local midnight.
 * @param ctx - Host context.
 * @param config - Settings.
 */
export function apply(ctx: Context, config: DailyWorkspaceConfig): void {
  const services = ctx as unknown as HostServices
  const logger: LoggerPort = {
    info: (message) => ctx.logger.info(`daily-workspace: ${message}`),
    warn: (message) => ctx.logger.warn(`daily-workspace: ${message}`),
  }
  const root = resolveRoot(config.root, homedir())
  if (root === undefined) {
    logger.warn(`root '${config.root}' is not an absolute path; nothing is managed`)
    return
  }

  const clock: ClockPort = { now: () => new Date() }
  const timer: TimerPort = {
    set: (delayMs, callback) => {
      const handle = setTimeout(callback, delayMs)
      return () => clearTimeout(handle)
    },
  }
  const run = (date: Date) =>
    registerDailyWorkspace({ root, registry: services.workspaceRegistry, fs: nodeFs, logger }, date)

  ctx.effect(() => startDailySchedule({ clock, timer, logger, run }), "daily-workspace: schedule")
}
