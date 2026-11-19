import { describe, expectTypeOf, it } from "vitest"
import type {
  UsageExtraUsage as ProviderExtra,
  UsageLimit as ProviderLimit,
  RateLimitOverage as ProviderOverage,
  UsageReport as ProviderReport,
  UsageLimitScope as ProviderScope,
  UsageLimitScopeName as ProviderScopeName,
  RateLimitSnapshot as ProviderSnapshot,
  RateLimitStatus as ProviderStatus,
  ClaudeSubscriptionUsage as ProviderUsage,
  RateLimitWindow as ProviderWindow,
} from "../../dsh-plugin-claude-subscription/src/usage/contract"
import type {
  UsageExtraUsage as ConsumerExtra,
  UsageLimit as ConsumerLimit,
  RateLimitOverage as ConsumerOverage,
  UsageReport as ConsumerReport,
  UsageLimitScope as ConsumerScope,
  UsageLimitScopeName as ConsumerScopeName,
  RateLimitSnapshot as ConsumerSnapshot,
  RateLimitStatus as ConsumerStatus,
  ClaudeSubscriptionUsage as ConsumerUsage,
  RateLimitWindow as ConsumerWindow,
} from "../src/shared/contract"

describe("the consumer contract", () => {
  it("matches the claude-subscription provider contract", () => {
    expectTypeOf<ConsumerStatus>().toEqualTypeOf<ProviderStatus>()
    expectTypeOf<ConsumerWindow>().toEqualTypeOf<ProviderWindow>()
    expectTypeOf<ConsumerOverage>().toEqualTypeOf<ProviderOverage>()
    expectTypeOf<ConsumerSnapshot>().toEqualTypeOf<ProviderSnapshot>()
    expectTypeOf<ConsumerScopeName>().toEqualTypeOf<ProviderScopeName>()
    expectTypeOf<ConsumerScope>().toEqualTypeOf<ProviderScope>()
    expectTypeOf<ConsumerLimit>().toEqualTypeOf<ProviderLimit>()
    expectTypeOf<ConsumerExtra>().toEqualTypeOf<ProviderExtra>()
    expectTypeOf<ConsumerReport>().toEqualTypeOf<ProviderReport>()
    expectTypeOf<ConsumerUsage>().toEqualTypeOf<ProviderUsage>()
  })
})
