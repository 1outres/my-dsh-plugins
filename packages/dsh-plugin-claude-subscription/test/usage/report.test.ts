import { afterEach, describe, expect, it } from "vitest"
import { FailureCode, NativeFailure } from "../../src/errors"
import { runUsageReport } from "../../src/usage/report"
import {
  type FakeClaudeStep,
  type HarnessOptions,
  type NativeHarness,
  nativeHarness,
} from "../support/native-harness"

const RATE_LIMITS = {
  limits: [
    {
      kind: "weekly_all",
      group: "weekly",
      percent: 19,
      resets_at: "2026-11-23T11:00:00.028658+00:00",
      scope: null,
      severity: "normal",
      is_active: true,
    },
    {
      kind: "weekly_scoped",
      group: "weekly",
      percent: 2,
      resets_at: "2026-11-23T11:00:00.028793+00:00",
      scope: { model: { display_name: "Fable" }, surface: null },
      severity: "normal",
      is_active: false,
    },
  ],
  extra_usage: {
    is_enabled: false,
    monthly_limit: null,
    used_credits: null,
    utilization: null,
    currency: null,
  },
}

const ASSISTANT_ROW = {
  type: "assistant",
  usage_report: {
    session: { total_cost_usd: 0 },
    rate_limits: RATE_LIMITS,
  },
}

describe("runUsageReport", () => {
  const harnesses: NativeHarness[] = []

  function harness(options: HarnessOptions = {}): NativeHarness {
    const created = nativeHarness(options)
    harnesses.push(created)
    return created
  }

  function withRows(rows: FakeClaudeStep[]): NativeHarness {
    return harness({ scenario: { usageScript: rows } })
  }

  async function failureOf(promise: Promise<unknown>): Promise<NativeFailure> {
    const outcome = await promise.then(
      () => undefined,
      (error: unknown) => error,
    )
    if (outcome instanceof NativeFailure) return outcome
    throw new Error(`expected a NativeFailure, got ${String(outcome)}`)
  }

  afterEach(async () => {
    await Promise.all(harnesses.splice(0).map((created) => created.dispose()))
  })

  it("runs the verified /usage command without a backend override", async () => {
    const created = withRows([{ out: ASSISTANT_ROW }])
    await runUsageReport(created.deps)
    const [invocation] = created.invocations()
    expect(invocation?.argv).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--tools",
      "",
      "--setting-sources",
      "",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--no-session-persistence",
      "/usage",
    ])
    expect(invocation?.env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(invocation?.env.DISABLE_AUTOUPDATER).toBe("1")
    expect(invocation?.env.USER).toBeTruthy()
  })

  it("reads the report into the contract", async () => {
    const created = withRows([{ out: ASSISTANT_ROW }])
    const before = Date.now()
    const report = await runUsageReport(created.deps)
    expect(report.limits).toEqual([
      {
        kind: "weekly_all",
        group: "weekly",
        percent: 19,
        resetsAt: 1_795_431_600_028,
        scope: null,
        severity: "normal",
        isActive: true,
      },
      {
        kind: "weekly_scoped",
        group: "weekly",
        percent: 2,
        resetsAt: 1_795_431_600_028,
        scope: { model: { displayName: "Fable" }, surface: null },
        severity: "normal",
        isActive: false,
      },
    ])
    expect(report.extraUsage).toEqual({
      isEnabled: false,
      monthlyLimit: null,
      usedCredits: null,
      utilization: null,
      currency: null,
    })
    expect(report.fetchedAt).toBeGreaterThanOrEqual(before)
    expect(report.fetchedAt).toBeLessThanOrEqual(Date.now())
  })

  it("keeps unknown kinds and severities", async () => {
    const created = withRows([
      {
        out: {
          type: "assistant",
          usage_report: {
            rate_limits: {
              limits: [
                {
                  kind: "monthly_scoped",
                  group: "monthly",
                  percent: 5,
                  resets_at: null,
                  scope: { model: null, surface: { display_name: "Web" } },
                  severity: "urgent",
                  is_active: true,
                },
              ],
              extra_usage: RATE_LIMITS.extra_usage,
            },
          },
        },
      },
    ])
    const report = await runUsageReport(created.deps)
    expect(report.limits[0]).toMatchObject({
      kind: "monthly_scoped",
      group: "monthly",
      severity: "urgent",
      resetsAt: null,
    })
  })

  it.each([
    ["no assistant row", [{ out: { type: "result", subtype: "success" } }], "no assistant row"],
    ["no usage report", [{ out: { type: "assistant" } }], "usage_report is missing"],
    [
      "no rate limits",
      [{ out: { type: "assistant", usage_report: {} } }],
      "usage_report.rate_limits is missing",
    ],
    [
      "no limits",
      [
        {
          out: {
            type: "assistant",
            usage_report: { rate_limits: { extra_usage: RATE_LIMITS.extra_usage } },
          },
        },
      ],
      "rate_limits.limits is missing",
    ],
    [
      "no extra usage",
      [
        {
          out: {
            type: "assistant",
            usage_report: { rate_limits: { limits: [] } },
          },
        },
      ],
      "rate_limits.extra_usage is missing",
    ],
    [
      "a percent that is text",
      [
        {
          out: {
            type: "assistant",
            usage_report: {
              rate_limits: {
                limits: [{ ...RATE_LIMITS.limits[0], percent: "19" }],
                extra_usage: RATE_LIMITS.extra_usage,
              },
            },
          },
        },
      ],
      "limits[0].percent is not a finite number",
    ],
    [
      "a reset that is text",
      [
        {
          out: {
            type: "assistant",
            usage_report: {
              rate_limits: {
                limits: [{ ...RATE_LIMITS.limits[0], resets_at: "tomorrow" }],
                extra_usage: RATE_LIMITS.extra_usage,
              },
            },
          },
        },
      ],
      "limits[0].resets_at is not an ISO 8601 time",
    ],
    [
      "a scope with no surface",
      [
        {
          out: {
            type: "assistant",
            usage_report: {
              rate_limits: {
                limits: [
                  {
                    ...RATE_LIMITS.limits[1],
                    scope: { model: { display_name: "Fable" } },
                  },
                ],
                extra_usage: RATE_LIMITS.extra_usage,
              },
            },
          },
        },
      ],
      "scope must hold model and surface",
    ],
  ])("rejects %s", async (_case, rows, message) => {
    const created = withRows(rows)
    const failure = await failureOf(runUsageReport(created.deps))
    expect(failure.code).toBe(FailureCode.nativeProtocol)
    expect(failure.message).toContain(message)
  })

  it("names invalid JSON and the CLI's stderr", async () => {
    const created = harness({
      scenario: { usageRaw: '{"type":', usageScript: [{ err: "usage probe stderr" }] },
    })
    const failure = await failureOf(runUsageReport(created.deps))
    expect(failure.code).toBe(FailureCode.nativeProtocol)
    expect(failure.message).toContain("invalid JSON")
    expect(failure.message).toContain("usage probe stderr")
  })

  it("raises conflictingEnvironment before it starts anything", async () => {
    const created = harness({
      scenario: { usageScript: [{ out: ASSISTANT_ROW }] },
      env: { ANTHROPIC_BASE_URL: "https://gateway.example.com" },
    })
    const failure = await failureOf(runUsageReport(created.deps))
    expect(failure.code).toBe(FailureCode.conflictingEnvironment)
    expect(created.subprocess.spawned).toHaveLength(0)
  })

  it("stops before it spawns when already aborted", async () => {
    const controller = new AbortController()
    controller.abort()
    const created = harness({ scenario: { usageScript: [{ out: ASSISTANT_ROW }] } })
    const failure = await failureOf(runUsageReport(created.deps, controller.signal))
    expect(failure.code).toBe(FailureCode.aborted)
    expect(created.subprocess.spawned).toHaveLength(0)
  })
})
