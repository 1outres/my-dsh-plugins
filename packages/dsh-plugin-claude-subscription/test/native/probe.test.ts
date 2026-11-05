import { afterEach, describe, expect, it } from "vitest"
import { FailureCode, NativeFailure } from "../../src/errors"
import { runProbe } from "../../src/native/probe"
import { type NativeHarness, nativeHarness } from "../support/native-harness"

describe("runProbe", () => {
  let harness: NativeHarness | undefined

  afterEach(async () => {
    await harness?.dispose()
  })

  it("raises timeout and ends the child when the limit passes", async () => {
    harness = nativeHarness()
    const script = "setTimeout(() => {}, 30000)"
    const outcome = await runProbe(harness.deps, {
      argv: [process.execPath, "-e", script],
      stdin: "ignore",
      env: {},
      cwd: harness.root,
      timeoutMs: 100,
    }).catch((error: unknown) => error)
    expect(outcome).toBeInstanceOf(NativeFailure)
    expect((outcome as NativeFailure).code).toBe(FailureCode.timeout)
  })

  it("returns stdout, stderr and the exit code", async () => {
    harness = nativeHarness()
    const output = await runProbe(harness.deps, {
      argv: [
        process.execPath,
        "-e",
        'process.stdout.write("out"); process.stderr.write("err"); process.exitCode = 3',
      ],
      stdin: "ignore",
      env: {},
      cwd: harness.root,
      timeoutMs: 10_000,
    })
    expect(output).toEqual({ stdout: "out", stderr: "err", exitCode: 3 })
  })

  it("raises nativeProtocol when the process cannot start", async () => {
    harness = nativeHarness()
    const outcome = await runProbe(harness.deps, {
      argv: ["/nonexistent/program"],
      stdin: "ignore",
      env: {},
      cwd: harness.root,
      timeoutMs: 10_000,
    }).catch((error: unknown) => error)
    expect((outcome as NativeFailure).code).toBe(FailureCode.nativeProtocol)
  })
})
