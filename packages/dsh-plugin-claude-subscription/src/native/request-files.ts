import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PreparedRequest } from "../contract"

export interface RequestFiles {
  directory: string
  system: string
  settings: string
  tools: string
}

/** The per-request files the CLI reads. The extra body goes in a file because of OS size limits. */
export async function writeRequestFiles(request: PreparedRequest): Promise<RequestFiles> {
  const directory = await mkdtemp(join(tmpdir(), "claude-subscription-"))
  const files: RequestFiles = {
    directory,
    system: join(directory, "system.md"),
    settings: join(directory, "settings.json"),
    tools: join(directory, "tools.json"),
  }
  const settings = { env: { CLAUDE_CODE_EXTRA_BODY: JSON.stringify(request.extraBody) } }
  // Settled, not raced, so no write is still running when the directory goes.
  const writes = await Promise.allSettled([
    writeFile(files.system, request.system),
    writeFile(files.settings, JSON.stringify(settings)),
    writeFile(files.tools, JSON.stringify(request.manifest)),
  ])
  const failed = writes.find((write) => write.status === "rejected")
  if (failed !== undefined) {
    await removeRequestFiles(files).catch(() => {})
    throw failed.reason
  }
  return files
}

/**
 * Removes the files when the call ends. On a fast return the CLI may still be draining, which is
 * safe: it read them at startup.
 */
export async function removeRequestFiles(files: RequestFiles): Promise<void> {
  await rm(files.directory, { recursive: true, force: true })
}
