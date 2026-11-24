import { readFile, realpath, stat } from "node:fs/promises"
import type { FileSystemPort, PathKind } from "./contract"

const MISSING_CODES: ReadonlySet<string> = new Set(["ENOENT", "ENOTDIR"])

function codeOf(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined
}

async function kindOf(path: string): Promise<PathKind> {
  try {
    const info = await stat(path)
    return info.isDirectory() ? "directory" : "file"
  } catch (error) {
    const code = codeOf(error)
    if (code !== undefined && MISSING_CODES.has(code)) return "missing"
    throw error
  }
}

export function createNodeFileSystem(): FileSystemPort {
  return {
    realpath: async (path) => await realpath(path),
    kind: kindOf,
    readText: async (path) => await readFile(path, "utf8"),
  }
}
