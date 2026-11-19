import type { Context } from "@deepseek-ai/cordis"
import { type ClaudeSubscriptionUsage, USAGE_SERVICE } from "./host/dependency"
import { ClaudeUsageService } from "./host/service"

export const name = "claude-usage"

/** Without the claude-subscription usage service this plugin stays inactive. */
export const inject = [USAGE_SERVICE]

export function apply(ctx: Context): void {
  const provider = ctx.get(USAGE_SERVICE) as ClaudeSubscriptionUsage | undefined
  if (provider === undefined) {
    throw new Error("claude-usage: the claudeSubscriptionUsage service is not available")
  }
  new ClaudeUsageService(ctx, provider)
}
