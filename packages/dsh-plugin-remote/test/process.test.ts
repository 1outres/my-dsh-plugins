import { describe, expect, it } from "vitest"
import { runProcess } from "../src/host/process"

const node = process.execPath

describe("runProcess", () => {
  it("captures stdout, stderr, and the exit code", async () => {
    const result = await runProcess([
      node,
      "-e",
      "process.stdout.write('out');process.stderr.write('err');process.exit(3)",
    ])
    expect(result).toEqual({ code: 3, stdout: "out", stderr: "err", timedOut: false })
  })

  it("passes input", async () => {
    const result = await runProcess([node, "-e", "process.stdin.pipe(process.stdout)"], {
      input: "hello",
    })
    expect(result.stdout).toBe("hello")
  })

  it("reports a timeout and stops the process", async () => {
    const result = await runProcess([node, "-e", "setTimeout(() => {}, 60000)"], { timeoutMs: 50 })
    expect(result.timedOut).toBe(true)
  })

  it("rejects when the command does not exist", async () => {
    await expect(runProcess(["/definitely/not/a/binary"])).rejects.toThrow(/Could not run/)
  })

  it("keeps only the tail of a large stream", async () => {
    const result = await runProcess(
      [node, "-e", "process.stdout.write('a'.repeat(50000) + 'TAIL')"],
      { maxBytes: 1024 },
    )
    expect(result.stdout.endsWith("TAIL")).toBe(true)
    expect(result.stdout.length).toBeLessThanOrEqual(1024)
  })

  it("aborts through the signal", async () => {
    const controller = new AbortController()
    const promise = runProcess([node, "-e", "setTimeout(() => {}, 60000)"], {
      signal: controller.signal,
    })
    controller.abort(new Error("cancelled by test"))
    await expect(promise).rejects.toThrow("cancelled by test")
  })
})
