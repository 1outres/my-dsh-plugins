import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { FailureCode, NativeFailure } from "../../src/errors"
import { sharedWorkdir } from "../../src/native/workdir"

const hooks = vi.hoisted(() => ({ afterMkdir: undefined as ((path: string) => void) | undefined }))

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>()
  return {
    ...real,
    mkdirSync: (...args: Parameters<typeof real.mkdirSync>) => {
      const result = real.mkdirSync(...args)
      hooks.afterMkdir?.(String(args[0]))
      return result
    },
  }
})

function modeOf(path: string): number {
  return statSync(path).mode & 0o777
}

function refusal(): NativeFailure {
  try {
    sharedWorkdir()
  } catch (error) {
    if (error instanceof NativeFailure) return error
    throw error
  }
  throw new Error("expected the shared workdir to be refused")
}

describe("sharedWorkdir", () => {
  let root: string
  let tempRoot: string

  const sharedPath = () => join(tempRoot, `claude-subscription-cwd-${process.getuid?.()}`)

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "workdir-test-"))
    tempRoot = join(root, "tmp")
    mkdirSync(tempRoot, { mode: 0o700 })
    vi.stubEnv("TMPDIR", tempRoot)
  })

  afterEach(() => {
    hooks.afterMkdir = undefined
    vi.unstubAllEnvs()
    rmSync(root, { recursive: true, force: true })
  })

  it("is stable, private, and survives being removed", () => {
    const first = sharedWorkdir()
    expect(first).toBe(sharedPath())
    expect(modeOf(first)).toBe(0o700)
    expect(sharedWorkdir()).toBe(first)
    rmSync(first, { recursive: true })
    expect(sharedWorkdir()).toBe(first)
    expect(existsSync(first)).toBe(true)
  })

  it("refreshes the directory time on every use", () => {
    const path = sharedWorkdir()
    utimesSync(path, 0, 0)
    sharedWorkdir()
    expect(statSync(path).mtimeMs).toBeGreaterThan(0)
  })

  it("accepts a world-writable parent only with the sticky bit", () => {
    chmodSync(tempRoot, 0o1777)
    expect(sharedWorkdir()).toBe(sharedPath())
  })

  it.each([
    ["a file", () => writeFileSync(sharedPath(), "not a directory")],
    [
      "a symlink",
      () => {
        const elsewhere = join(root, "elsewhere")
        mkdirSync(elsewhere, { mode: 0o700 })
        symlinkSync(elsewhere, sharedPath())
      },
    ],
    [
      "a directory open to others",
      () => {
        mkdirSync(sharedPath())
        chmodSync(sharedPath(), 0o777)
      },
    ],
    ["a parent others can write", () => chmodSync(tempRoot, 0o777)],
  ])("raises instead of moving elsewhere when it finds %s", (_kind, plant) => {
    plant()
    const failure = refusal()
    expect(failure.code).toBe(FailureCode.nativeProtocol)
    expect(failure.message).toContain(sharedPath())
  })

  it("does not tighten a directory it did not create", () => {
    mkdirSync(sharedPath())
    chmodSync(sharedPath(), 0o755)
    refusal()
    expect(modeOf(sharedPath())).toBe(0o755)
  })

  it("closes a fresh directory that a default ACL widened", () => {
    hooks.afterMkdir = (path) => chmodSync(path, 0o770)
    const path = sharedWorkdir()
    expect(modeOf(path)).toBe(0o700)
    expect(sharedWorkdir()).toBe(path)
  })

  it("never follows a symlink swapped in after the mkdir", () => {
    const victim = join(root, "victim")
    writeFileSync(victim, "ours")
    chmodSync(victim, 0o644)
    const before = modeOf(victim)
    hooks.afterMkdir = (path) => {
      rmSync(path, { recursive: true })
      symlinkSync(victim, path)
    }
    const failure = refusal()
    expect(failure.code).toBe(FailureCode.nativeProtocol)
    expect(modeOf(victim)).toBe(before)
    expect(lstatSync(sharedPath()).isSymbolicLink()).toBe(true)
  })
})
