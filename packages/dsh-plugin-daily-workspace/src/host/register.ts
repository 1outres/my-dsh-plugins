import type { DailyPaths, FsPort, LoggerPort, WorkspaceRegistryPort } from "../contract"
import { errorMessage } from "./error"
import { dailyPaths } from "./paths"

export interface RegistrationPorts {
  /** Absolute directory that holds the year folders. */
  readonly root: string
  readonly registry: WorkspaceRegistryPort
  readonly fs: FsPort
  readonly logger: LoggerPort
}

function foldersOf(paths: DailyPaths): readonly string[] {
  return [paths.year, paths.month, paths.day]
}

/**
 * Create today's folders and register the year, month, and day as Workspaces,
 * in that order. A Workspace already registered under that canonical path is
 * left alone. A failure is logged and never thrown.
 * @param ports - Host ports.
 * @param date - Moment whose local date is managed.
 */
export async function registerDailyWorkspace(ports: RegistrationPorts, date: Date): Promise<void> {
  const paths = dailyPaths(ports.root, date)
  try {
    if (await ports.fs.ensureDir(paths.day)) ports.logger.info(`created ${paths.day}`)
    const registered = new Set(ports.registry.list().map((workspace) => workspace.path))
    for (const path of foldersOf(paths)) {
      const canonical = await ports.fs.realpath(path)
      if (registered.has(canonical)) continue
      await ports.registry.create(path)
      registered.add(canonical)
      ports.logger.info(`registered ${path}`)
    }
  } catch (error) {
    ports.logger.warn(`cannot register today's folders: ${errorMessage(error)}`)
  }
}
