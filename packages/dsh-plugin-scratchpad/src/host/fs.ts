import {
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  statSync,
} from "node:fs"
import type { FsOps } from "./types"

/** {@link FsOps} over `node:fs`. */
export const nodeFs: FsOps = {
  exists: (path) => existsSync(path),
  isEmptyDir: (path) => {
    try {
      return statSync(path).isDirectory() && readdirSync(path).length === 0
    } catch {
      return false
    }
  },
  rename: (from, to) => renameSync(from, to),
  removeEmptyDir: (path) => rmdirSync(path),
  ensureDir: (path) => {
    mkdirSync(path, { recursive: true })
  },
  realpath: (path) => {
    try {
      return realpathSync(path)
    } catch {
      return undefined
    }
  },
  listDirs: (path) => {
    try {
      return readdirSync(path, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    } catch {
      return []
    }
  },
}
