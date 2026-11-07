import { createHash } from "node:crypto"
import type { Context } from "@deepseek-ai/cordis"
import { defineTool } from "@deepseek-ai/dsh-tools"
import { isUsablePath } from "../../shared/shell"
import { replaceLiteral, sliceFileLines } from "../files/range"
import { redactSecrets } from "../output"
import type { HostRuntime } from "../runtime"
import { clipHead, positiveInteger, requireFileCapability, runtimeFor } from "./common"
import { sudoParameter } from "./schema"

const readDescription = `Read a UTF-8 text file on a Linux target. It takes the same offset and limit as the built-in read tool. The file's hash is remembered for this session so a later remote_write can detect a change on the remote.`

const writeDescription = `Create or fully replace a UTF-8 text file on a Linux target. Overwriting an existing file needs remote_read of the same path first in this session; the write is refused if the remote file changed after that read. The file keeps its mode and owner, and a temporary sibling makes the replacement atomic.`

const editDescription = `Replace literal text in a UTF-8 file on a Linux target. It takes the same arguments as the built-in edit tool; old_string must be unique unless replace_all is true. The change is refused when the remote file changed while it was being edited.`

function formatRead(
  path: string,
  offset: number,
  totalLines: number,
  lines: Array<{ number: number; text: string }>,
  truncated: boolean,
  maxBytes: number,
): string {
  const body = lines.map((line) => `${String(line.number)}\t${line.text}`).join("\n")
  const header = `${path} (lines ${String(offset)}-${String(lines.at(-1)?.number ?? offset - 1)} of ${String(totalLines)})`
  const footer = truncated ? "\n[more lines follow; read with a larger offset]" : ""
  return clipHead(`${header}\n${body}${footer}`, maxBytes)
}

export function registerFileTools(ctx: Context, host: HostRuntime): void {
  ctx.tools.register(
    defineTool({
      name: "remote_read",
      description: readDescription,
      parameters: {
        target: { type: "string", required: true, description: "Registered Linux target name." },
        path: { type: "string", required: true, description: "Absolute path on the remote host." },
        offset: { type: "integer", description: "1-based first line to return. Defaults to 1." },
        limit: {
          type: "integer",
          description: "Maximum number of lines to return. Defaults to 2000.",
        },
        sudo: sudoParameter,
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            path: { type: "string", required: true },
            offset: { type: "integer", required: true },
            totalLines: { type: "integer", required: true },
            lines: {
              type: "array",
              required: true,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  number: { type: "integer", required: true },
                  text: { type: "string", required: true },
                },
              },
            },
            truncated: { type: "boolean", required: true },
          },
        },
        render: (_args, value) => [
          {
            type: "text",
            text: formatRead(
              value.path,
              value.offset,
              value.totalLines,
              value.lines,
              value.truncated,
              host.config.maxOutputBytes,
            ),
          },
        ],
      },
      async execute(args, exec) {
        const { runtime, delegated } = runtimeFor(ctx, host, exec)
        const target = runtime.requireTarget(args.target)
        requireFileCapability(runtime, target)
        if (!isUsablePath(args.path)) throw new Error("path must be a non-empty path")
        const offset = positiveInteger(args.offset, 1, "offset")
        const limit = positiveInteger(args.limit, 2000, "limit")
        const outcome = await runtime.transport.readFile(
          target,
          args.path,
          args.sudo === true,
          runtime.call(exec.callId, exec.signal, !delegated),
        )
        if (!outcome.exists) throw new Error(`No such remote file: ${args.path}`)
        runtime.readHashes.set(runtime.readKey(target, args.path, args.sudo === true), outcome.hash)
        const result = sliceFileLines(outcome.content, args.path, offset, limit)
        return {
          ...result,
          lines: result.lines.map((line) => ({
            number: line.number,
            text: redactSecrets(line.text, runtime.secretValues()),
          })),
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: "remote_write",
      description: writeDescription,
      parameters: {
        target: { type: "string", required: true, description: "Registered Linux target name." },
        path: { type: "string", required: true, description: "Absolute path on the remote host." },
        content: { type: "string", required: true, description: "Full UTF-8 content to write." },
        sudo: sudoParameter,
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            path: { type: "string", required: true },
            operation: { type: "string", required: true, enum: ["create", "update"] },
          },
        },
        render: (_args, value) => [
          {
            type: "text",
            text: `${value.operation === "create" ? "Created" : "Updated"} ${value.path}.`,
          },
        ],
      },
      async execute(args, exec) {
        const { runtime, delegated } = runtimeFor(ctx, host, exec)
        const target = runtime.requireTarget(args.target)
        requireFileCapability(runtime, target)
        if (!isUsablePath(args.path)) throw new Error("path must be a non-empty path")
        const sudo = args.sudo === true
        const call = runtime.call(exec.callId, exec.signal, !delegated)
        const current = await runtime.transport.hashFile(target, args.path, sudo, call)
        const key = runtime.readKey(target, args.path, sudo)
        let expectedHash: string | null = null
        if (current.exists) {
          const seen = runtime.readHashes.get(key)
          if (seen === undefined) {
            throw new Error(`Read ${args.path} with remote_read before overwriting it`)
          }
          expectedHash = seen
        }
        await runtime.transport.writeFile(
          target,
          args.path,
          args.content,
          expectedHash,
          { sudo },
          call,
        )
        runtime.readHashes.set(key, createHash("sha256").update(args.content, "utf8").digest("hex"))
        return {
          path: args.path,
          operation: current.exists ? ("update" as const) : ("create" as const),
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: "remote_edit",
      description: editDescription,
      parameters: {
        target: { type: "string", required: true, description: "Registered Linux target name." },
        path: { type: "string", required: true, description: "Absolute path on the remote host." },
        old_string: { type: "string", required: true, description: "Literal text to replace." },
        new_string: {
          type: "string",
          required: true,
          description: "Replacement text. Use an empty string to delete the match.",
        },
        replace_all: {
          type: "boolean",
          description:
            "Replace all matches. Defaults to false; when false, old_string must appear exactly once.",
        },
        sudo: sudoParameter,
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            path: { type: "string", required: true },
            replacements: { type: "integer", required: true },
          },
        },
        render: (_args, value) => [
          {
            type: "text",
            text: `Edited ${value.path} (${String(value.replacements)} replacement${value.replacements === 1 ? "" : "s"}).`,
          },
        ],
      },
      async execute(args, exec) {
        const { runtime, delegated } = runtimeFor(ctx, host, exec)
        const target = runtime.requireTarget(args.target)
        requireFileCapability(runtime, target)
        if (!isUsablePath(args.path)) throw new Error("path must be a non-empty path")
        const sudo = args.sudo === true
        const call = runtime.call(exec.callId, exec.signal, !delegated)
        const outcome = await runtime.transport.readFile(target, args.path, sudo, call)
        if (!outcome.exists) throw new Error(`No such remote file: ${args.path}`)
        const replaced = replaceLiteral(
          outcome.content,
          args.old_string,
          args.new_string,
          args.replace_all === true,
        )
        await runtime.transport.writeFile(
          target,
          args.path,
          replaced.content,
          outcome.hash,
          { sudo },
          call,
        )
        runtime.readHashes.set(
          runtime.readKey(target, args.path, sudo),
          createHash("sha256").update(replaced.content, "utf8").digest("hex"),
        )
        return { path: args.path, replacements: replaced.replacements }
      },
    }),
  )
}
