import type { Context } from "@deepseek-ai/cordis"
import { defineTool } from "@deepseek-ai/dsh-tools"
import {
  DEFAULT_SERIAL_LINE_ENDING,
  DEFAULT_SERIAL_SETTINGS,
  formatSerialSettings,
} from "../../shared/serial"
import { validateSshOptions } from "../../shared/ssh-options"
import {
  assertSerialTargetFields,
  assertTargetFields,
  isValidSecretField,
  normalizeTarget,
} from "../../shared/target"
import type { RemoteTarget, SerialSettings, SerialTarget, SshTarget } from "../../shared/types"
import type { HostRuntime, RootRuntime } from "../runtime"
import { compilePromptPattern } from "../sessions/terminal"
import { requireUserCard, runtimeFor } from "./common"
import { targetParameter, targetStatusSchema, targetValueSchema } from "./schema"

const addDescription = `Register one target for this session: an SSH host, or a serial console cable behind a dsh-serial-agent. For an SSH target the connection is opened during registration; for a serial target the agent must be online and the device must exist. Call remote_serial_agents first to see the authorized agents, their device paths, and which ports are already in use. Serial consoles often show a prompt only after an empty Enter: open a session, then call remote_session_send with an empty text.

The user sees a card with the destination or agent fingerprint, the device, and one password field per name in the secrets list. They approve it and type the passwords there. Never ask for a password in the chat and never put one in a tool argument.

Use remote_target_list to see what is registered. A target cannot be edited; remove it and add it again.`

const listDescription = `List the targets of this session: their settings, whether their connection is open, their interactive sessions, and which password fields have a value. Password values are never returned.`

const removeDescription = `Remove a registered target. It is refused while another SSH target uses it as a jump host. Its interactive sessions and connection are closed, and its passwords are forgotten.`

interface AddArgs {
  name: string
  transport: "ssh" | "serial"
  kind: "linux" | "network"
  host?: string
  user?: string
  port?: number
  jump?: string
  sshOptions?: string[]
  agent?: string
  device?: string
  baudRate?: number
  dataBits?: 5 | 6 | 7 | 8
  parity?: "none" | "even" | "odd"
  stopBits?: 1 | 2
  flowControl?: "none" | "rtscts" | "xonxoff"
  lineEnding?: "cr" | "lf" | "crlf"
  secrets?: string[]
  promptPattern?: string
  initCommands?: string[]
}

const SSH_ONLY = ["host", "user", "port", "jump", "sshOptions"] as const
const SERIAL_ONLY = [
  "agent",
  "device",
  "baudRate",
  "dataBits",
  "parity",
  "stopBits",
  "flowControl",
  "lineEnding",
] as const

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
          enum: ["ssh", "serial"],
          description:
            "ssh for a host reached by the OpenSSH client on the Harness Host; serial for a console cable on a dsh-serial-agent.",
        },
        kind: {
          type: "string",
          required: true,
          enum: ["linux", "network"],
          description: "linux for a shell with files and sudo; network for a device command line.",
        },
        host: {
          type: "string",
          description: "SSH only. Host name, IP address, or a Host alias from ~/.ssh/config.",
        },
        user: {
          type: "string",
          description: "SSH only. Login user. Omit to use the ssh config or the local user name.",
        },
        port: {
          type: "integer",
          description: "SSH only. SSH port. Omit to use the ssh config or 22.",
        },
        jump: {
          type: "string",
          description: "SSH only. Name of an already registered SSH target to use as a jump host.",
        },
        sshOptions: {
          type: "array",
          items: { type: "string" },
          description:
            'SSH only. Options for ssh -o as Key=Value strings, such as ["StrictHostKeyChecking=accept-new"]. Options that run a local command are refused.',
        },
        agent: {
          type: "string",
          description:
            "Serial only. Agent name from the serialAgents config. Call remote_serial_agents first.",
        },
        device: {
          type: "string",
          description: "Serial only. Device path on the agent machine, such as /dev/ttyUSB0.",
        },
        baudRate: {
          type: "integer",
          default: DEFAULT_SERIAL_SETTINGS.baudRate,
          description: "Serial only. Baud rate, usually 9600 or 115200. Defaults to 9600.",
        },
        dataBits: {
          type: "integer",
          enum: [5, 6, 7, 8],
          default: DEFAULT_SERIAL_SETTINGS.dataBits,
          description: "Serial only. Data bits. Defaults to 8.",
        },
        parity: {
          type: "string",
          enum: ["none", "even", "odd"],
          default: DEFAULT_SERIAL_SETTINGS.parity,
          description: "Serial only. Parity. Defaults to none.",
        },
        stopBits: {
          type: "integer",
          enum: [1, 2],
          default: DEFAULT_SERIAL_SETTINGS.stopBits,
          description: "Serial only. Stop bits. Defaults to 1.",
        },
        flowControl: {
          type: "string",
          enum: ["none", "rtscts", "xonxoff"],
          default: DEFAULT_SERIAL_SETTINGS.flowControl,
          description: "Serial only. Flow control. Defaults to none.",
        },
        lineEnding: {
          type: "string",
          enum: ["cr", "lf", "crlf"],
          default: DEFAULT_SERIAL_LINE_ENDING,
          description: "Serial only. Bytes one Enter sends: cr (default), lf, or crlf.",
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
            'Commands to type when an interactive session opens, such as ["terminal length 0"].',
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
            text:
              value.target.transport === "ssh"
                ? `Connected to ${value.target.name} (${value.target.host} as a ${value.target.kind} target).`
                : `Connected to ${value.target.name} (${value.target.agent}:${value.target.device} at ${formatSerialSettings(value.target.serial)}).`,
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
        validateSecretFields(args.secrets)
        const target =
          args.transport === "ssh"
            ? buildSshTarget(args, runtime, host)
            : await buildSerialTarget(args, host, exec.signal)
        if (target.promptPattern !== undefined) compilePromptPattern(target.promptPattern)
        const prompter = runtime.prompter(exec.callId, exec.signal)
        const values = await prompter.askRegistration(target, target.secrets)
        host.secrets.setMany(runtime.sessionId, target.name, values)
        try {
          await runtime.transportFor(target).connect(target, runtime.call(exec.callId, exec.signal))
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
                : value.targets.map(describeTargetStatus).join("\n\n"),
          },
        ],
      },
      async execute(_args, exec) {
        const { runtime } = runtimeFor(ctx, host, exec)
        const targets = runtime.targets()
        const rows = await Promise.all(
          targets.map(async (target) => ({
            target,
            connected: await runtime.transportFor(target).isConnected(target, runtime.sessionId),
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
        const dependents = runtime
          .targets()
          .filter((candidate) => candidate.transport === "ssh" && candidate.jump === args.name)
        if (dependents.length > 0) {
          throw new Error(
            `${args.name} is the jump host of ${dependents.map((candidate) => candidate.name).join(", ")}; remove those targets first`,
          )
        }
        for (const session of runtime.sessions.statusesFor(target.name))
          runtime.sessions.close(session.id)
        await runtime.transportFor(target).disconnect(target, runtime.sessionId)
        for (const key of [...runtime.readHashes.keys()]) {
          if (key.startsWith(`${target.name}\u0000`)) runtime.readHashes.delete(key)
        }
        host.secrets.deleteTarget(runtime.sessionId, target.name)
        return { name: target.name }
      },
    }),
  )
}

function validateSecretFields(secrets: readonly string[] | undefined): void {
  for (const field of secrets ?? []) {
    if (!isValidSecretField(field)) {
      throw new Error(`${JSON.stringify(field)} is not a valid password field name`)
    }
  }
}

function buildSshTarget(args: AddArgs, runtime: RootRuntime, host: HostRuntime): SshTarget {
  for (const key of SERIAL_ONLY) {
    if (args[key] !== undefined) {
      throw new Error(
        `${key} is only for the serial transport; remove it or set transport to "serial"`,
      )
    }
  }
  if (args.host === undefined) throw new Error("host is required for the ssh transport")
  const sshOptions = validateSshOptions(args.sshOptions ?? [], host.config.blockedSshOptions)
  const target: SshTarget = {
    name: args.name,
    transport: "ssh",
    kind: args.kind,
    host: args.host,
    ...(args.user === undefined ? {} : { user: args.user }),
    ...(args.port === undefined ? {} : { port: args.port }),
    ...(args.jump === undefined ? {} : { jump: args.jump }),
    sshOptions,
    secrets: args.secrets ?? [],
    ...(args.promptPattern === undefined ? {} : { promptPattern: args.promptPattern }),
    initCommands: args.initCommands ?? [],
  }
  assertTargetFields(target)
  if (target.jump !== undefined) {
    const jump = runtime.find(target.jump)
    if (jump === undefined) {
      throw new Error(`The jump target ${JSON.stringify(target.jump)} is not registered`)
    }
    if (jump.transport !== "ssh") throw new Error("The jump target must use the ssh transport")
  }
  return normalizeTarget(target) as SshTarget
}

async function buildSerialTarget(
  args: AddArgs,
  host: HostRuntime,
  signal: AbortSignal,
): Promise<SerialTarget> {
  for (const key of SSH_ONLY) {
    if (args[key] !== undefined) {
      throw new Error(`${key} is only for the ssh transport; remove it or set transport to "ssh"`)
    }
  }
  if (args.agent === undefined) throw new Error("agent is required for the serial transport")
  if (args.device === undefined) throw new Error("device is required for the serial transport")
  const authorized = host.serial.authorization(args.agent)
  if (authorized === undefined) {
    throw new Error(
      `No serial agent named ${JSON.stringify(args.agent)} is configured; add its key to serialAgents or call remote_serial_agents`,
    )
  }
  const connection = host.serial.requireConnection(args.agent, authorized.key.fingerprint)
  const ports = await connection.request("ports.list", {}, signal)
  if (!ports.ports.some((port) => port.path === args.device)) {
    throw new Error(
      `Serial device ${JSON.stringify(args.device)} is not offered by agent ${JSON.stringify(args.agent)}; call remote_serial_agents to list its ports`,
    )
  }
  const serial: SerialSettings = {
    baudRate: args.baudRate ?? DEFAULT_SERIAL_SETTINGS.baudRate,
    dataBits: args.dataBits ?? DEFAULT_SERIAL_SETTINGS.dataBits,
    parity: args.parity ?? DEFAULT_SERIAL_SETTINGS.parity,
    stopBits: args.stopBits ?? DEFAULT_SERIAL_SETTINGS.stopBits,
    flowControl: args.flowControl ?? DEFAULT_SERIAL_SETTINGS.flowControl,
  }
  const target: SerialTarget = {
    name: args.name,
    transport: "serial",
    kind: args.kind,
    agent: args.agent,
    agentFingerprint: authorized.key.fingerprint,
    device: args.device,
    serial,
    lineEnding: args.lineEnding ?? DEFAULT_SERIAL_LINE_ENDING,
    secrets: args.secrets ?? [],
    ...(args.promptPattern === undefined ? {} : { promptPattern: args.promptPattern }),
    initCommands: args.initCommands ?? [],
  }
  assertSerialTargetFields(target)
  return normalizeTarget(target) as SerialTarget
}

function describeTargetStatus(row: {
  target: RemoteTarget
  connected: boolean
  sessions: Array<{ id: string; state: "open" | "exited" }>
  secretFields: Array<{ name: string; present: boolean }>
}): string {
  const target = row.target
  const secretFields =
    row.secretFields.length === 0
      ? "none"
      : row.secretFields
          .map((field) => `${field.name}=${field.present ? "set" : "missing"}`)
          .join(", ")
  const sessions =
    row.sessions.length === 0
      ? "none"
      : row.sessions.map((session) => `${session.id}(${session.state})`).join(", ")
  const tail = [`  passwords: ${secretFields}`, `  sessions: ${sessions}`]
  if (target.transport === "ssh") {
    return [
      `${target.name}: ${target.kind} ${target.user === undefined ? "" : `${target.user}@`}${target.host}${target.port === undefined ? "" : `:${String(target.port)}`}`,
      `  connection: ${row.connected ? "open" : "closed"}`,
      `  jump: ${target.jump ?? "none"}`,
      `  ssh options: ${target.sshOptions.length === 0 ? "none" : target.sshOptions.join(" ")}`,
      ...tail,
    ].join("\n")
  }
  return [
    `${target.name}: ${target.kind} serial ${target.agent}:${target.device} ${formatSerialSettings(target.serial)}`,
    `  connection: ${row.connected ? "open (agent online)" : "closed (agent offline or key changed)"}`,
    `  line ending: ${target.lineEnding}`,
    ...tail,
  ].join("\n")
}
