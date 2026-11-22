import type { Context } from "@deepseek-ai/cordis"
import type { Agent } from "@deepseek-ai/dsh-agent"
import { defineTool, type ValueSchemaSpec } from "@deepseek-ai/dsh-tools"
import type { AgentPort, PresetId } from "../contract"
import { type CallerFacts, callerRefusal, isRestartOffered } from "./admission"
import type { RestartCoordinator } from "./coordinator"

export interface RestartToolOptions {
  /** Agent preset ids that count as Creator mode. */
  readonly presets: readonly PresetId[]
  readonly coordinator: RestartCoordinator
  /** Whether the launcher can end the process. */
  readonly canExit: () => boolean
  /** Preset and tree position of one live agent. */
  readonly factsOf: (agent: Agent) => CallerFacts
  /** The coordinator's view of one live agent. */
  readonly agentOf: (agent: Agent) => AgentPort
}

const description = `Restart DeepSeek Harness from this Creator session. The restart happens after this turn ends: the process exits with the configured code, the service supervisor starts DeepSeek Harness again, and this session resumes automatically when it is back.

Any other running session blocks the restart, and a sub-agent cannot use this tool.`

const restartResultSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    restarting: { type: "boolean", required: true },
    message: { type: "string", required: true },
  },
} satisfies ValueSchemaSpec

const resultMessage =
  "DeepSeek Harness restarts after this turn ends. The service supervisor starts it again, and this session resumes automatically when it is back, then continues the task. End your turn now."

/**
 * Register `restart_harness` on the Host tool service.
 * @param ctx - Host context carrying the tool service.
 * @param options - Creator presets, the coordinator, and the agent adapters.
 */
export function registerRestartTool(ctx: Context, options: RestartToolOptions): void {
  ctx.tools.register(
    defineTool({
      name: "restart_harness",
      description,
      parameters: {
        resume_note: {
          type: "string",
          description:
            "What to do after the restart. It comes back in the message that resumes this session.",
        },
      },
      output: {
        schema: restartResultSchema,
        render: (_args, value) => [{ type: "text", text: value.message }],
      },
      async execute(args, exec) {
        const agent = exec.agent
        if (agent === undefined) throw new Error("This tool needs a live agent session")
        const refusal = callerRefusal(options.factsOf(agent), options.presets)
        if (refusal !== undefined) throw new Error(refusal)
        options.coordinator.request(options.agentOf(agent), args.resume_note)
        exec.concludeTurn()
        return { restarting: true, message: resultMessage }
      },
    }),
    {
      when: ({ agent }) =>
        options.canExit() && isRestartOffered(options.factsOf(agent), options.presets),
    },
  )
}
