import type { UsageReportResult } from "../shared/contract"
import { createUsageStore } from "./store"
import type { ClientContext, UsageBridge, UsageRemote, UsageStreamHandle } from "./types"

const PACKAGE = "@1outres/dsh-plugin-claude-usage"
const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 30_000

/** The Host method names and the wire names must stay in sync with the Host service. */
const codec = {
  mode: "strict" as const,
  typeSymbol: "@1outres/dsh-plugin-claude-usage/json",
  create: () => ({ parse: (value: unknown) => value }),
}

const contribution = {
  package: PACKAGE,
  descriptors: [
    {
      id: `${PACKAGE}#snapshots`,
      service: "claudeUsage",
      namespace: "claudeUsage",
      method: "snapshots",
      mode: "stream",
      invocation: { kind: "direct" },
      parameters: [],
      cancellation: { parameter: "signal" },
      result: codec,
    },
    {
      id: `${PACKAGE}#report`,
      service: "claudeUsage",
      namespace: "claudeUsage",
      method: "report",
      invocation: { kind: "direct" },
      parameters: [],
      result: codec,
    },
  ],
}

/** The plugin mounts this namespace itself, so an inject would deadlock. */
function usageRemote(ctx: ClientContext): UsageRemote {
  const remote = ctx.get("remote.claudeUsage")
  if (remote === undefined) throw new Error("The claudeUsage namespace is not mounted")
  return remote as UsageRemote
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createUsageBridge(
  ctx: ClientContext,
  options: { baseDelayMs?: number; maxDelayMs?: number } = {},
): UsageBridge {
  const store = createUsageStore()
  const baseDelayMs = options.baseDelayMs ?? BASE_DELAY_MS
  const maxDelayMs = options.maxDelayMs ?? MAX_DELAY_MS
  let backoffMs = baseDelayMs
  let disposed = false
  let handle: UsageStreamHandle | undefined

  const pump = async (): Promise<void> => {
    try {
      await ctx.remote.$mount(contribution)
    } catch {
      // Without the Host half there is nothing to show, so the bar stays hidden.
      return
    }
    if (disposed) return
    while (!disposed) {
      let delivered = false
      try {
        handle = usageRemote(ctx).snapshots()
        for await (const item of handle) {
          if (disposed) break
          delivered = true
          backoffMs = baseDelayMs
          store.receive(item)
        }
      } catch {
        if (disposed) return
      } finally {
        handle = undefined
      }
      if (disposed) return
      store.reset()
      await delay(backoffMs)
      backoffMs = delivered ? baseDelayMs : Math.min(backoffMs * 2, maxDelayMs)
    }
  }
  void pump()

  return {
    store,
    async loadReport(): Promise<UsageReportResult> {
      try {
        const result = await usageRemote(ctx).report()
        if (!result.ok) return { ok: false, message: result.error?.message ?? "" }
        return result.value
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
    },
    dispose() {
      disposed = true
      handle?.dispose()
      handle = undefined
      store.reset()
    },
  }
}
