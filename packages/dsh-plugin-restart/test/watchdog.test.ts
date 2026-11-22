import { afterEach, describe, expect, it, vi } from "vitest"
import { armExitWatchdog } from "../src/host/watchdog"

describe("exit watchdog", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("ends the process with the configured code when the delay passes", () => {
    vi.useFakeTimers()
    const exit = vi.fn()
    armExitWatchdog(exit, 75, 15000)
    vi.advanceTimersByTime(14999)
    expect(exit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(exit).toHaveBeenCalledWith(75)
  })

  it("holds no process handle open by itself", () => {
    const unref = vi.fn()
    vi.spyOn(globalThis, "setTimeout").mockImplementation((() => ({ unref })) as never)
    armExitWatchdog(vi.fn(), 75, 15000)
    expect(unref).toHaveBeenCalledTimes(1)
  })
})
