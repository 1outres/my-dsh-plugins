import { basename, dirname, isAbsolute, join, resolve } from "node:path"
import type { FileSystemPort } from "./contract"

const GITDIR_LINE = /^gitdir:\s*(.+)$/u

export function parseGitdir(text: string, marker: string): string {
  const match = GITDIR_LINE.exec(text.trim())
  const gitdir = match?.[1]?.trim()
  if (gitdir === undefined || gitdir.length === 0) {
    throw new Error(`Invalid .git file at ${marker}: it does not name a gitdir.`)
  }
  return gitdir
}

export async function checkoutRootOf(
  directory: string,
  fs: FileSystemPort,
): Promise<string | undefined> {
  let current = directory
  for (;;) {
    if ((await fs.kind(join(current, ".git"))) !== "missing") return current
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

async function mainCheckoutRoot(
  worktreeRoot: string,
  fs: FileSystemPort,
): Promise<string | undefined> {
  const marker = join(worktreeRoot, ".git")
  if ((await fs.kind(marker)) !== "file") return undefined
  const gitdir = parseGitdir(await fs.readText(marker), marker)
  const gitdirPath = isAbsolute(gitdir) ? resolve(gitdir) : resolve(worktreeRoot, gitdir)
  const commonFile = join(gitdirPath, "commondir")
  if ((await fs.kind(commonFile)) === "missing") return undefined
  const common = (await fs.readText(commonFile)).trim()
  if (common.length === 0) {
    throw new Error(`The commondir file at ${commonFile} is empty.`)
  }
  const commonPath = isAbsolute(common) ? resolve(common) : resolve(gitdirPath, common)
  return basename(commonPath) === ".git" ? dirname(commonPath) : undefined
}

export async function checkoutDirectory(directory: string, fs: FileSystemPort): Promise<string> {
  const root = await checkoutRootOf(directory, fs)
  if (root === undefined) return directory
  const main = await mainCheckoutRoot(root, fs)
  if (main === undefined || main === root) return directory
  return main + directory.slice(root.length)
}
