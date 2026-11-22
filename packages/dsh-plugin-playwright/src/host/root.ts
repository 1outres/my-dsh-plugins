import type { Agent } from "@deepseek-ai/dsh-agent"
import type { ToolRunContext } from "@deepseek-ai/dsh-tools"

export function requireAgent(exec: ToolRunContext): Agent {
  if (exec.agent === undefined) throw new Error("This tool needs a live agent session")
  return exec.agent
}
