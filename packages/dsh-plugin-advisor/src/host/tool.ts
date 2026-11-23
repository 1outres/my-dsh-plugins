import {
  defineTool,
  ToolContextUnavailableError,
  type ToolDefinition,
  type ValueSchemaSpec,
} from "@deepseek-ai/dsh-tools"
import type { AdvisorPorts, AdvisorSettings, ExecutorRecords } from "../contract"
import { consultAdvisor } from "./consult"
import { ADVISOR_TOOL_DESCRIPTION, TRUNCATED_NOTE } from "./prompts"

export interface AdvisorToolDeps {
  readonly settings: () => AdvisorSettings
  readonly ports: AdvisorPorts
}

const adviceSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    advice: { type: "string", required: true },
    model: { type: "string", required: true },
    truncated: { type: "boolean", required: true },
  },
} satisfies ValueSchemaSpec

interface AdvisedSession {
  deriveMessages(): ExecutorRecords["messages"]
  requestHeader(): { readonly tools?: ExecutorRecords["tools"] } | undefined
}

function recordsOf(session: AdvisedSession): ExecutorRecords {
  const header = session.requestHeader()
  if (header === undefined) {
    throw new ToolContextUnavailableError("advisor: the session has not made a model request yet")
  }
  return { tools: header.tools ?? [], messages: session.deriveMessages() }
}

export function createAdvisorTool(deps: AdvisorToolDeps): ToolDefinition {
  return defineTool({
    name: "advisor",
    description: ADVISOR_TOOL_DESCRIPTION,
    parameters: {},
    output: {
      schema: adviceSchema,
      render: (_args, value) => [
        {
          type: "text",
          text: value.truncated ? `${value.advice}\n\n${TRUNCATED_NOTE}` : value.advice,
        },
      ],
    },
    async execute(_args, exec) {
      const agent = exec.agent
      if (agent === undefined) {
        throw new ToolContextUnavailableError("advisor: this tool needs a calling agent session")
      }
      const settings = deps.settings()
      return consultAdvisor(deps.ports, {
        settings,
        records: recordsOf(agent.session),
        nested: exec.parent !== undefined,
        sessionId: agent.session.id,
        signal: exec.signal,
      })
    },
    presentCall: () => ({ card: "generic", title: "Advisor", kind: "other" }),
    presentResult: (_args, result) => ({
      card: "generic",
      title: result.isError ? "Advisor unavailable" : "Advisor reviewed",
      content: result.content,
    }),
  })
}
