import type { Context } from "@deepseek-ai/cordis"
import type {} from "@deepseek-ai/dsh-agent"
import type {} from "@deepseek-ai/dsh-llm"
import type {} from "@deepseek-ai/dsh-tools"
import { Config, isAdvisorConfigured, readAdvisorSettings } from "./config"
import type { AdvisorConfig } from "./contract"
import { createAdvisorTool } from "./host/tool"

export const name = "advisor"

export const inject = ["tools", "llm"]

export { Config }

export function apply(ctx: Context, config: AdvisorConfig): void {
  const tool = createAdvisorTool({
    settings: () => readAdvisorSettings(config),
    ports: {
      stream: (options) => ctx.llm.stream(options),
      fileText: (ref) => ctx.llm.fileRequestText(ref),
    },
  })
  ctx.tools.register(tool, { when: () => isAdvisorConfigured(config) })
}
