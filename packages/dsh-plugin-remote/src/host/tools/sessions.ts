import type { Context } from "@deepseek-ai/cordis"
import { defineTool } from "@deepseek-ai/dsh-tools"
import { isValidSecretField } from "../../shared/target"
import type { HostRuntime } from "../runtime"
import { clipHead, positiveInteger, runtimeFor, timeoutOf } from "./common"
import { sessionBreakResultSchema, sessionStatusSchema } from "./schema"

const NAME = /^[A-Za-z0-9._-]{0,64}$/u

const openDescription = `Open one interactive shell (or device command line) through the target's connection and keep it open. SSH and serial targets both work. Opening again with the same target and name reuses the running session.

The opening output is returned after the target's initCommands run and the output reaches its prompt or stops changing. Use this session for a device CLI, for sudo enable prompts, or for work that needs many commands in one shell. It is not a terminal emulator: full-screen programs such as top or vi are not supported.`

const sendDescription = `Type text or one named password field into an open interactive session and wait for the output to settle.

The result says why waiting stopped: prompt (the target's prompt matched), idle (no output for a while), timeout, or exited. Pass secret instead of text to send a password field without the model ever seeing its value. Use submit false to send without Enter.`

const readDescription = `Read a page of an open interactive session without sending anything. The offset is a 1-based line number.`

const closeDescription = `Close an interactive session and its remote shell.`

const breakDescription = `Send a serial BREAK to an open serial session, for example to enter the ROMMON or boot loader prompt of a network device. Only serial sessions support this; SSH sessions report an error.`

function renderSession(
  output: string,
  reason: string,
  state: string,
  exitCode: number | undefined,
  maxBytes: number,
): string {
  const header = `[${state}${exitCode === undefined ? "" : `, exit code ${String(exitCode)}`}; stopped on ${reason}]`
  return clipHead(output.length === 0 ? header : `${header}\n${output}`, maxBytes)
}

export function registerSessionTools(ctx: Context, host: HostRuntime): void {
  ctx.tools.register(
    defineTool({
      name: "remote_session_open",
      description: openDescription,
      parameters: {
        target: { type: "string", required: true, description: "Registered target name." },
        name: {
          type: "string",
          description: "Optional label to reuse this session, such as core-sw or root shell.",
        },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            session: { ...sessionStatusSchema, required: true },
            output: { type: "string", required: true },
            reason: {
              type: "string",
              required: true,
              enum: ["prompt", "idle", "timeout", "exited"],
            },
            reused: { type: "boolean", required: true },
          },
        },
        render: (_args, value) => [
          {
            type: "text",
            text: [
              `${value.reused ? "Reusing" : "Opened"} session ${value.session.id} on ${value.session.target}.`,
              value.output.length === 0 ? "" : value.output,
            ]
              .filter((part) => part.length > 0)
              .join("\n"),
          },
        ],
      },
      async execute(args, exec) {
        const { runtime, delegated } = runtimeFor(ctx, host, exec)
        const target = runtime.requireTarget(args.target)
        if (args.name !== undefined && !NAME.test(args.name))
          throw new Error("name must be up to 64 letters, digits, dots, underscores, or hyphens")
        const result = await runtime.sessions.open(
          target,
          args.name,
          runtime.call(exec.callId, exec.signal, !delegated),
        )
        return result
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: "remote_session_send",
      description: sendDescription,
      parameters: {
        sessionId: {
          type: "string",
          required: true,
          description: "Session id returned by remote_session_open.",
        },
        text: { type: "string", description: "Text to type into the session." },
        secret: {
          type: "string",
          description:
            "Name of a password field on the target; the user is asked for it when it has no value.",
        },
        submit: { type: "boolean", description: "Add Enter after the text. Defaults to true." },
        wait: {
          type: "boolean",
          description: "Wait for the output to settle before returning. Defaults to true.",
        },
        timeoutMs: {
          type: "integer",
          description:
            "Longest wait in milliseconds. Defaults to the configured session send timeout.",
        },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            sessionId: { type: "string", required: true },
            output: { type: "string", required: true },
            reason: {
              type: "string",
              required: true,
              enum: ["prompt", "idle", "timeout", "exited"],
            },
            state: { type: "string", required: true, enum: ["open", "exited"] },
            exitCode: { type: "integer" },
          },
        },
        render: (_args, value) => [
          {
            type: "text",
            text: renderSession(
              value.output,
              value.reason,
              value.state,
              value.exitCode,
              host.config.maxOutputBytes,
            ),
          },
        ],
      },
      async execute(args, exec) {
        const { runtime, delegated } = runtimeFor(ctx, host, exec)
        if ((args.text === undefined) === (args.secret === undefined))
          throw new Error("Give exactly one of text or secret")
        if (args.secret !== undefined && !isValidSecretField(args.secret))
          throw new Error("secret must be a password field name")
        const timeoutMs = timeoutOf(
          args.timeoutMs,
          host.config.sessionSendTimeoutMs,
          host.config.execMaxTimeoutMs,
        )
        return await runtime.sessions.send(
          args.sessionId,
          {
            ...(args.text === undefined ? {} : { text: args.text }),
            ...(args.secret === undefined ? {} : { secret: args.secret }),
            submit: args.submit ?? true,
            wait: args.wait ?? true,
            timeoutMs,
          },
          runtime.call(exec.callId, exec.signal, !delegated),
          runtime.prompter(exec.callId, exec.signal, !delegated),
        )
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: "remote_session_read",
      description: readDescription,
      parameters: {
        sessionId: {
          type: "string",
          required: true,
          description: "Session id returned by remote_session_open.",
        },
        offset: { type: "integer", description: "1-based first line to return. Defaults to 1." },
        count: {
          type: "integer",
          description: "Maximum number of lines to return. Defaults to 200.",
        },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            sessionId: { type: "string", required: true },
            offset: { type: "integer", required: true },
            count: { type: "integer", required: true },
            totalLines: { type: "integer", required: true },
            lines: { type: "array", required: true, items: { type: "string" } },
          },
        },
        render: (_args, value) => [
          {
            type: "text",
            text: clipHead(
              value.lines
                .map((line, index) => `${String(value.offset + index)}\t${line}`)
                .join("\n"),
              host.config.maxOutputBytes,
            ),
          },
        ],
      },
      async execute(args, exec) {
        const { runtime } = runtimeFor(ctx, host, exec)
        const offset = positiveInteger(args.offset, 1, "offset")
        const count = Math.min(positiveInteger(args.count, 200, "count"), 2000)
        return runtime.sessions.read(args.sessionId, offset, count)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: "remote_session_break",
      description: breakDescription,
      parameters: {
        sessionId: {
          type: "string",
          required: true,
          description: "Session id returned by remote_session_open.",
        },
        durationMs: {
          type: "integer",
          default: 300,
          description: "Length of the BREAK in milliseconds, from 1 to 5000. Defaults to 300.",
        },
      },
      output: {
        schema: sessionBreakResultSchema,
        render: (_args, value) => [
          {
            type: "text",
            text: `Sent a ${String(value.durationMs)} ms BREAK to session ${value.sessionId}.`,
          },
        ],
      },
      async execute(args, exec) {
        const { runtime } = runtimeFor(ctx, host, exec)
        const durationMs = args.durationMs ?? 300
        if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > 5000) {
          throw new Error("durationMs must be an integer from 1 to 5000")
        }
        return await runtime.sessions.sendBreak(args.sessionId, durationMs)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: "remote_session_close",
      description: closeDescription,
      parameters: {
        sessionId: {
          type: "string",
          required: true,
          description: "Session id returned by remote_session_open.",
        },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: { closed: { type: "boolean", required: true } },
        },
        render: (_args, value) => [
          {
            type: "text",
            text: value.closed ? "Session closed." : "That session was already gone.",
          },
        ],
      },
      async execute(args, exec) {
        const { runtime } = runtimeFor(ctx, host, exec)
        return { closed: await runtime.sessions.close(args.sessionId) }
      },
    }),
  )
}
