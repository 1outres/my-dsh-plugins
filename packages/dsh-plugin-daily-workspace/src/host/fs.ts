import { mkdir, realpath } from "node:fs/promises"
import type { FsPort } from "../contract"

/** {@link FsPort} over `node:fs/promises`. */
export const nodeFs: FsPort = {
  ensureDir: async (path) => {
    const created = await mkdir(path, { recursive: true })
    return created !== undefined
  },
  realpath: (path) => realpath(path),
}
