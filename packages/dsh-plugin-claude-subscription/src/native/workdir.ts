import {
  closeSync,
  constants,
  fchmodSync,
  lstatSync,
  mkdirSync,
  openSync,
  statSync,
  utimesSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FailureCode, NativeFailure } from "../errors"

const OPEN_TO_OTHERS = 0o077
const WRITABLE_BY_OTHERS = 0o022
const STICKY_BIT = 0o1000

function refused(path: string, why: string, cause?: unknown): NativeFailure {
  return new NativeFailure(
    `The working directory ${path} was refused: ${why}.`,
    FailureCode.nativeProtocol,
    cause === undefined ? {} : { cause },
  )
}

function assertSafeParent(parent: string, path: string): void {
  const { mode } = statSync(parent)
  if ((mode & WRITABLE_BY_OTHERS) !== 0 && (mode & STICKY_BIT) === 0) {
    throw refused(path, "others can rename it out of its parent directory")
  }
}

function isExisting(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST"
}

// Some filesystems turn a fresh 0700 mkdir into 0770, and the check below would then refuse our
// own directory on the next call. The mode changes through a descriptor opened without following
// links: a parent that others can write lets them swap in a symlink right after the mkdir.
function tighten(path: string): void {
  const descriptor = openSync(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  )
  try {
    fchmodSync(descriptor, 0o700)
  } finally {
    closeSync(descriptor)
  }
}

function createPrivate(path: string): void {
  try {
    mkdirSync(path, { mode: 0o700 })
  } catch (error) {
    if (isExisting(error)) return
    throw error
  }
  tighten(path)
}

function assertPrivate(path: string, uid: number): void {
  const info = lstatSync(path)
  if (!info.isDirectory()) throw refused(path, "it is not a real directory")
  if (info.uid !== uid) throw refused(path, "another user owns it")
  if ((info.mode & OPEN_TO_OTHERS) !== 0) throw refused(path, "it is open to other users")
}

/**
 * The CLI's working directory for every call of this OS user.
 *
 * The CLI writes its working directory into the environment block of every request, so a path
 * that changes between calls moves the prompt-cache prefix (upstream #14, #43). The path sits in a
 * temp directory that others may share, so it must be our own real directory, closed to others.
 * Raises `NativeFailure` when it is refused.
 */
export function sharedWorkdir(): string {
  const uid = process.getuid?.()
  const parent = tmpdir()
  const path = join(parent, `claude-subscription-cwd-${uid}`)
  if (uid === undefined) throw refused(path, "this platform has no user id")
  try {
    assertSafeParent(parent, path)
    createPrivate(path)
    assertPrivate(path, uid)
    const now = new Date()
    utimesSync(path, now, now)
  } catch (error) {
    if (error instanceof NativeFailure) throw error
    throw refused(path, error instanceof Error ? error.message : String(error), error)
  }
  return path
}
