import type { Context } from "@deepseek-ai/cordis"
import type { Agent } from "@deepseek-ai/dsh-agent"
import type { ToolRunContext } from "@deepseek-ai/dsh-tools"

export function requireAgent(exec: ToolRunContext): Agent {
  if (exec.agent === undefined) throw new Error("This tool needs a live agent session")
  return exec.agent
}

/** Walk live agent ownership up to the top-level session. */
export function resolveRootAgent(ctx: Context, agent: Agent): Agent {
  let current = agent
  const seen = new Set<string>()
  for (;;) {
    if (seen.has(current.id)) return current
    seen.add(current.id)
    const owner = ctx.agents
      .list()
      .find(
        (candidate) => candidate.id !== current.id && ctx.agents.isOwnedBy(current.id, candidate),
      )
    if (owner === undefined) return current
    current = owner
  }
}
