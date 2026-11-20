import { describe, expect, it } from "vitest"
import type { ClockPort, LoggerPort, TimerPort } from "../src/contract"
import { CHECK_INTERVAL_MS, startDailySchedule } from "../src/host/schedule"

class FakeClock implements ClockPort {
  moment = new Date(2026, 10, 20, 12, 0, 0)

  now(): Date {
    return new Date(this.moment.getTime())
  }
}

interface PendingTimer {
  readonly delayMs: number
  readonly callback: () => void
}

class FakeTimer implements TimerPort {
  readonly pending = new Map<number, PendingTimer>()
  readonly cancelled: number[] = []
  private nextId = 1

  set(delayMs: number, callback: () => void): () => void {
    const id = this.nextId++
    this.pending.set(id, { delayMs, callback })
    return () => {
      this.cancelled.push(id)
      this.pending.delete(id)
    }
  }

  delays(): number[] {
    return [...this.pending.values()].map((timer) => timer.delayMs)
  }

  fire(): void {
    const [id, timer] = [...this.pending.entries()][0] ?? []
    if (id === undefined || timer === undefined) throw new Error("no pending timer")
    this.pending.delete(id)
    timer.callback()
  }
}

class FakeLogger implements LoggerPort {
  readonly warnings: string[] = []

  info(): void {}

  warn(message: string): void {
    this.warnings.push(message)
  }
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function deferred() {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function setup() {
  const clock = new FakeClock()
  const timer = new FakeTimer()
  const logger = new FakeLogger()
  const runs: Date[] = []
  const start = (
    run = async (date: Date) => {
      runs.push(date)
    },
  ) => startDailySchedule({ clock, timer, logger, run })
  return { clock, timer, logger, runs, start }
}

describe("daily schedule", () => {
  it("runs at once and schedules the next check five minutes later", async () => {
    const h = setup()
    h.start()
    await flush()
    expect(h.runs).toEqual([new Date(2026, 10, 20, 12, 0, 0)])
    expect(h.timer.delays()).toEqual([CHECK_INTERVAL_MS])
  })

  it("caps the check at the time left before local midnight", async () => {
    const h = setup()
    h.clock.moment = new Date(2026, 10, 20, 23, 59, 0)
    h.start()
    await flush()
    expect(h.timer.delays()).toEqual([60_000])
  })

  it("starts no pass when a check lands on the same local day", async () => {
    const h = setup()
    h.start()
    await flush()
    h.clock.moment = new Date(2026, 10, 20, 12, 5, 0)
    h.timer.fire()
    await flush()
    expect(h.runs).toHaveLength(1)
    expect(h.timer.delays()).toEqual([CHECK_INTERVAL_MS])
  })

  it("starts exactly one pass for the new day after a long jump in wall time", async () => {
    const h = setup()
    h.clock.moment = new Date(2026, 10, 20, 23, 59, 0)
    h.start()
    await flush()
    // The machine slept through the one minute timer: the fire reads the morning clock.
    h.clock.moment = new Date(2026, 10, 21, 9, 0, 0)
    h.timer.fire()
    await flush()
    expect(h.runs).toHaveLength(2)
    expect(h.runs[1]).toEqual(new Date(2026, 10, 21, 9, 0, 0))
    expect(h.timer.delays()).toEqual([CHECK_INTERVAL_MS])
    h.timer.fire()
    await flush()
    expect(h.runs).toHaveLength(2)
  })

  it("waits for a running pass before it starts the next one", async () => {
    const h = setup()
    const gate = deferred()
    let started = 0
    h.start(async () => {
      started += 1
      if (started === 1) await gate.promise
    })
    await flush()
    h.clock.moment = new Date(2026, 10, 21, 0, 1, 0)
    h.timer.fire()
    await flush()
    expect(started).toBe(1)
    gate.resolve()
    await flush()
    expect(started).toBe(2)
  })

  it("cancels the timer and stops running after dispose", async () => {
    const h = setup()
    const dispose = h.start()
    await flush()
    dispose()
    expect(h.timer.cancelled).toHaveLength(1)
    expect(h.timer.pending.size).toBe(0)
  })

  it("logs a warning and keeps scheduling when a pass fails", async () => {
    const h = setup()
    h.start(async () => {
      throw new Error("disk is full")
    })
    await flush()
    expect(h.logger.warnings).toEqual(["run failed: disk is full"])
    expect(h.timer.delays()).toEqual([CHECK_INTERVAL_MS])
  })
})
