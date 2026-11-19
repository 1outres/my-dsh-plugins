import { Context } from "@deepseek-ai/cordis"
import { describe, expect, it, vi } from "vitest"
import type { RateLimitSnapshot, UsageReport } from "../../src/usage/contract"
import { ClaudeSubscriptionUsageService, USAGE_SERVICE } from "../../src/usage/service"

const SNAPSHOT: RateLimitSnapshot = {
  observedAt: 1_800_000_000_000,
  status: "allowed_warning",
  windows: [{ kind: "seven_day", utilization: 0.8, resetsAt: 1_800_500_000_000 }],
}

const REPORT: UsageReport = {
  fetchedAt: 1_800_000_000_000,
  limits: [],
  extraUsage: {
    isEnabled: false,
    monthlyLimit: null,
    usedCredits: null,
    utilization: null,
    currency: null,
  },
}

describe("ClaudeSubscriptionUsageService", () => {
  it("provides the usage service under its fixed name", async () => {
    const ctx = new Context()
    const service = new ClaudeSubscriptionUsageService(ctx, async () => REPORT)
    try {
      expect(service.name).toBe(USAGE_SERVICE)
      expect(ctx.get("claudeSubscriptionUsage")).toBeDefined()
      expect(ctx.get("claudeSubscriptionUsage")?.current()).toBeNull()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it("keeps the current snapshot for subscribers", async () => {
    const ctx = new Context()
    const service = new ClaudeSubscriptionUsageService(ctx, async () => REPORT)
    try {
      expect(service.current()).toBeNull()
      const seen = vi.fn()
      const off = service.subscribe(seen)
      service.record(SNAPSHOT)
      expect(service.current()).toBe(SNAPSHOT)
      expect(seen).toHaveBeenCalledWith(SNAPSHOT)
      off()
      service.record({ ...SNAPSHOT, observedAt: 1_800_000_030_000 })
      expect(seen).toHaveBeenCalledTimes(1)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it("runs the report with the caller's signal", async () => {
    const ctx = new Context()
    const report = vi.fn(async () => REPORT)
    const service = new ClaudeSubscriptionUsageService(ctx, report)
    try {
      const controller = new AbortController()
      await expect(service.fetchReport(controller.signal)).resolves.toBe(REPORT)
      expect(report).toHaveBeenCalledWith(controller.signal)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
