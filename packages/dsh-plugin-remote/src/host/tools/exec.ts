import type { Context } from "@deepseek-ai/cordis"
import { defineTool } from "@deepseek-ai/dsh-tools"
import { formatExecOutput, redactSecrets } from "../output"
import type { HostRuntime } from "../runtime"
import { requireExecCapability, requireSudoCapability, runtimeFor, timeoutOf } from "./common"
import { execOutputSchema, sudoParameter } from "./schema"

const description = `Run one command on a registered target through its existing SSH connection. It works like the bash tool: a non-zero exit code is a normal result, not a tool error.

Use standard input for data. Output beyond the configured limit keeps its tail. Long work should use an interactive session instead; there is no background mode. On a network target the command runs once through the SSH exec channel; use remote_session_open when the device does not support that.

Never put a password in the command. Include a password field in the target's secrets and use an interactive session for login or enable prompts.`

export function registerExecTool(ctx: Context, host: HostRuntime): void {
  ctx.tools.register(
    defineTool({
      name: "remote_exec",
      description,
      parameters: {
        target: { type: "string", required: true, description: "Registered target name." },
        command: {
          type: "string",
          required: true,
          description: "Command to run through the remote shell.",
        },
        sudo: sudoParameter,
        stdin: { type: "string", description: "Text passed to the command's standard input." },
        timeoutMs: {
          type: "integer",
          description: `Milliseconds before the command is stopped. Defaults to ${String(host.config.execTimeoutMs)} and is capped at ${String(host.config.execMaxTimeoutMs)}.`,
        },
        description: { type: "string", description: "Short note shown on the tool card." },
      },
      output: {
        schema: execOutputSchema,
        render: (_args, value) => [{ type: "text", text: formatExecOutput(value) }],
      },
      async execute(args, exec) {
        const { runtime, delegated } = runtimeFor(ctx, host, exec)
        const target = runtime.requireTarget(args.target)
        requireExecCapability(runtime, target)
        const sudo = args.sudo === true
        requireSudoCapability(runtime, target, sudo)
        if (args.command.trim().length === 0) throw new Error("command must not be empty")
        const timeoutMs = timeoutOf(
          args.timeoutMs,
          host.config.execTimeoutMs,
          host.config.execMaxTimeoutMs,
        )
        const result = await runtime.transportFor(target).exec(
          target,
          {
            command: args.command,
            ...(args.stdin === undefined ? {} : { stdin: args.stdin }),
            sudo,
            timeoutMs,
          },
          runtime.call(exec.callId, exec.signal, !delegated),
        )
        const secrets = runtime.secretValues()
        return {
          ...result,
          stdout: redactSecrets(result.stdout, secrets),
          stderr: redactSecrets(result.stderr, secrets),
        }
      },
    }),
  )
}
