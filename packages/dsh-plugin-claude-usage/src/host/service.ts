import type { Context } from "@deepseek-ai/cordis"
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol"
import type {
  ClaudeSubscriptionUsage,
  UsageReportResult,
  UsageStreamState,
} from "../shared/contract"
import { reportResult } from "./report"
import { snapshotStream } from "./snapshots"

/** Cordis calls Remote methods with its service proxy as `this`, where a private field throws. */
const PROVIDER = Symbol("claudeUsageProvider")

/** Browser bridge: the latest rate limit snapshot stream and the `/usage` report. */
export class ClaudeUsageService extends TypertRemoteService {
  [PROVIDER]: ClaudeSubscriptionUsage

  constructor(ctx: Context, provider: ClaudeSubscriptionUsage) {
    super(ctx, "claudeUsage")
    this[PROVIDER] = provider
  }

  @Remote({ mode: "stream" })
  async *snapshots(signal?: AbortSignal): AsyncIterable<UsageStreamState> {
    yield* snapshotStream(this[PROVIDER], signal)
  }

  @Remote
  report(): Promise<UsageReportResult> {
    return reportResult(this[PROVIDER], this.ctx.invocation?.signal)
  }
}
