import type { Context } from "@deepseek-ai/cordis"
import { defineTool } from "@deepseek-ai/dsh-tools"
import { validateSshOptions } from "../../shared/ssh-options"
import { assertTargetFields, isValidSecretField, normalizeTarget } from "../../shared/target"
import type { RemoteTarget } from "../../shared/types"
import type { HostRuntime } from "../runtime"
import { compilePromptPattern } from "../sessions/terminal"
import { requireUserCard, runtimeFor } from "./common"
import { targetParameter, targetStatusSchema, targetValueSchema } from "./schema"

const addDescription = `Register one SSH target for this session and open its connection.

The user sees a card showing the destination, the jump target, the ssh -o options, and one password field per name in the secrets list. They approve it and type the passwords there. Never ask for a password in the chat and never put one in a tool argument.

Use remote_target_list to see what is registered. A target cannot be edited; remove it and add it again. The connection is reused by the other remote_* tools.`

const listDescription = `List the SSH targets of this session: their settings, whether their connection is open, their interactive sessions, and which password fields have a value. Password values are never returned.`

const removeDescription = `Remove a registered SSH target. It is refused while another target uses it as a jump host. Its interactive sessions and connection are closed, and its passwords are forgotten.`

export function registerTargetTools(ctx: Context, host: HostRuntime): void {
  ctx.tools.register(
    defineTool({
      name: "remote_target_add",
      description: addDescription,
      parameters: {
        name: {
          type: "string",
          required: true,
          description:
            "Short unique name for this session, such as web1 or core-sw. Lowercase letters, digits, and hyphens; it is the id used by every other remote tool.",
        },
        transport: {
          type: "string",
          required: true,
          enum: ["ssh"],
          description: "Connection method. Only ssh is available.",
        },
        kind: {
          type: "string",
          required: true,
          enum: ["linux", "network"],
          description: "linux for a shell with files and sudo; network for a device command line.",
        },
        host: {
          type: "string",
          required: true,
          description: "Host name, IP address, or a Host alias from ~/.ssh/config.",
        },
        user: {
          type: "string",
          description: "Login user. Omit to use the ssh config or the local user name.",
        },
        port: { type: "integer", description: "SSH port. Omit to use the ssh config or 22." },
        jump: {
          type: "string",
          description: "Name of an already registered target to use as a jump host.",
        },
        sshOptions: {
          type: "array",
          items: { type: "string" },
          description:
            'Options for ssh -o as Key=Value strings, such as ["StrictHostKeyChecking=accept-new"]. Options that run a local command are refused.',
        },
        secrets: {
          type: "array",
          items: { type: "string" },
          description:
            'Password field names to ask the user for now, such as ["login","sudo"]. Use login for the SSH password, sudo for sudo, enable for a device enable password.',
        },
        promptPattern: {
          type: "string",
          description:
            "Regular expression for the prompt of an interactive session. Omit to use the plugin default.",
        },
        initCommands: {
          type: "array",
          items: { type: "string" },
          description:
            'Commands to type when an interactive session opens, such as ["terminal length 0"]. ',
        },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            target: { ...targetValueSchema, required: true },
            connected: { type: "boolean", required: true },
          },
        },
        render: (_args, value) => [
          {
            type: "text",
            text: `Connected to ${value.target.name} (${value.target.host} as a ${value.target.kind} target).`,
          },
        ],
        presentationMeta: (_args, value) => ({ kind: "remote/target-added", target: value.target }),
      },
      async execute(args, exec) {
        const { runtime, agent } = runtimeFor(ctx, host, exec)
        requireUserCard(runtime, agent)
        if (runtime.find(args.name) !== undefined) {
          throw new Error(
            `A target named ${JSON.stringify(args.name)} is already registered; remove it first to change it`,
          )
        }
        const sshOptions = validateSshOptions(args.sshOptions ?? [], host.config.blockedSshOptions)
        const secrets = args.secrets ?? []
        for (const field of secrets) {
          if (!isValidSecretField(field))
            throw new Error(`${JSON.stringify(field)} is not a valid password field name`)
        }
        const target: RemoteTarget = normalizeTarget({
          name: args.name,
          transport: "ssh",
          kind: args.kind,
          host: args.host,
          ...(args.user === undefined ? {} : { user: args.user }),
          ...(args.port === undefined ? {} : { port: args.port }),
          ...(args.jump === undefined ? {} : { jump: args.jump }),
          sshOptions,
          secrets,
          ...(args.promptPattern === undefined ? {} : { promptPattern: args.promptPattern }),
          initCommands: args.initCommands ?? [],
        })
        assertTargetFields(target)
        if (target.promptPattern !== undefined) compilePromptPattern(target.promptPattern)
        if (target.jump !== undefined) {
          const jump = runtime.find(target.jump)
          if (jump === undefined)
            throw new Error(`The jump target ${JSON.stringify(target.jump)} is not registered`)
          if (jump.transport !== "ssh")
            throw new Error("The jump target must use the ssh transport")
        }
        const prompter = runtime.prompter(exec.callId, exec.signal)
        const values = await prompter.askRegistration(target, target.secrets)
        host.secrets.setMany(runtime.sessionId, target.name, values)
        try {
          await runtime.transport.connect(target, runtime.call(exec.callId, exec.signal))
        } catch (error) {
          host.secrets.deleteTarget(runtime.sessionId, target.name)
          throw error
        }
        return { target, connected: true }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: "remote_target_list",
      description: listDescription,
      parameters: {},
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: { targets: { type: "array", required: true, items: targetStatusSchema } },
        },
        render: (_args, value) => [
          {
            type: "text",
            text:
              value.targets.length === 0
                ? "No remote targets are registered."
                : value.targets
                    .map((row) => {
                      const secretFields = row.secretFields
                        .map((field) => `${field.name}=${field.present ? "set" : "missing"}`)
                        .join(", ")
                      const sessions =
                        row.sessions.length === 0
                          ? "none"
                          : row.sessions
                              .map((session) => `${session.id}(${session.state})`)
                              .join(", ")
                      return [
                        `${row.target.name}: ${row.target.kind} ${row.target.user === undefined ? "" : `${row.target.user}@`}${row.target.host}${row.target.port === undefined ? "" : `:${String(row.target.port)}`}`,
                        `  connection: ${row.connected ? "open" : "closed"}`,
                        `  jump: ${row.target.jump ?? "none"}`,
                        `  ssh options: ${row.target.sshOptions.length === 0 ? "none" : row.target.sshOptions.join(" ")}`,
                        `  passwords: ${secretFields.length === 0 ? "none" : secretFields}`,
                        `  sessions: ${sessions}`,
                      ].join("\n")
                    })
                    .join("\n\n"),
          },
        ],
      },
      async execute(_args, exec) {
        const { runtime } = runtimeFor(ctx, host, exec)
        const targets = runtime.targets()
        const rows = await Promise.all(
          targets.map(async (target) => ({
            target,
            connected: await runtime.transport.isConnected(target),
            sessions: runtime.sessions.statusesFor(target.name),
            secretFields: host.secrets.names(runtime.sessionId, target.name, [
              ...new Set([
                ...target.secrets,
                ...host.secrets.fieldNames(runtime.sessionId, target.name),
              ]),
            ]),
          })),
        )
        return { targets: rows }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: "remote_target_remove",
      description: removeDescription,
      parameters: { name: targetParameter },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: { name: { type: "string", required: true } },
        },
        render: (_args, value) => [{ type: "text", text: `Removed ${value.name}.` }],
        presentationMeta: (_args, value) => ({ kind: "remote/target-removed", name: value.name }),
      },
      async execute(args, exec) {
        const { runtime } = runtimeFor(ctx, host, exec)
        const target = runtime.requireTarget(args.name)
        const dependents = runtime.targets().filter((candidate) => candidate.jump === args.name)
        if (dependents.length > 0) {
          throw new Error(
            `${args.name} is the jump host of ${dependents.map((candidate) => candidate.name).join(", ")}; remove those targets first`,
          )
        }
        for (const session of runtime.sessions.statusesFor(target.name))
          runtime.sessions.close(session.id)
        await runtime.transport.disconnect(target)
        for (const key of [...runtime.readHashes.keys()]) {
          if (key.startsWith(`${target.name}\u0000`)) runtime.readHashes.delete(key)
        }
        host.secrets.deleteTarget(runtime.sessionId, target.name)
        return { name: target.name }
      },
    }),
  )
}
