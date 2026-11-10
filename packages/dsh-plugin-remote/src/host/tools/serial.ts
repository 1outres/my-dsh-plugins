import type { Context } from "@deepseek-ai/cordis"
import { defineTool } from "@deepseek-ai/dsh-tools"
import { formatSerialSettings } from "../../shared/serial"
import type { SerialAgentStatus } from "../../shared/types"
import type { HostRuntime } from "../runtime"
import type { WirePortInfo } from "../serial/protocol"
import { clipHead, runtimeFor } from "./common"
import { serialAgentStatusSchema } from "./schema"

const description = `List the dsh-serial-agents authorized in serialAgents, whether each one is online, and which serial ports it offers. Ports already used by this session show their target name; ports used by another session are marked.

Call this before remote_target_add with transport "serial" to find an agent and a device path. An offline agent cannot be used.`

export function registerSerialTools(ctx: Context, host: HostRuntime): void {
  ctx.tools.register(
    defineTool({
      name: "remote_serial_agents",
      description,
      parameters: {},
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            agents: { type: "array", required: true, items: serialAgentStatusSchema },
          },
        },
        render: (_args, value) => [
          {
            type: "text",
            text: clipHead(renderAgents(value.agents), host.config.maxOutputBytes),
          },
        ],
      },
      async execute(_args, exec) {
        const { runtime } = runtimeFor(ctx, host, exec)
        const agents = await Promise.all(
          host.serial.list().map(async (entry): Promise<SerialAgentStatus> => {
            const connection = entry.connection
            if (connection === undefined) {
              return {
                name: entry.name,
                fingerprint: entry.fingerprint,
                online: false,
                ports: [],
              }
            }
            let ports: WirePortInfo[]
            try {
              ports = (await connection.request("ports.list", {}, exec.signal)).ports
            } catch (error) {
              throw new Error(
                `Could not list the serial ports of agent ${JSON.stringify(entry.name)}: ${errorMessage(error)}`,
              )
            }
            return {
              name: entry.name,
              fingerprint: entry.fingerprint,
              online: true,
              info: connection.info,
              ports: ports.map((port) => {
                const lease = host.serial.leaseOf(entry.name, port.path)
                const usedBy =
                  lease !== undefined && lease.sessionId === runtime.sessionId
                    ? lease.targetName
                    : undefined
                return {
                  path: port.path,
                  ...(port.description === undefined ? {} : { description: port.description }),
                  ...(port.usb === undefined ? {} : { usb: port.usb }),
                  open: port.open,
                  ...(port.settings === undefined ? {} : { settings: port.settings }),
                  ...(usedBy === undefined ? {} : { usedBy }),
                  usedElsewhere: lease !== undefined && lease.sessionId !== runtime.sessionId,
                }
              }),
            }
          }),
        )
        return { agents }
      },
    }),
  )
}

function renderAgents(agents: readonly SerialAgentStatus[]): string {
  if (agents.length === 0) {
    return "No serial agents are configured. Add each agent public key to the serialAgents config."
  }
  return agents.map(renderAgent).join("\n\n")
}

function renderAgent(agent: SerialAgentStatus): string {
  const head = `${agent.name} ${agent.fingerprint} ${agent.online ? "online" : "offline"}`
  if (!agent.online || agent.info === undefined) {
    return [head, "  offline; start dsh-serial-agent on the machine to use its ports"].join("\n")
  }
  const info = `  version ${agent.info.version}, hostname ${agent.info.hostname}, ${agent.info.os}/${agent.info.arch}`
  const ports =
    agent.ports.length === 0
      ? "  ports: none"
      : ["  ports:", ...agent.ports.map((port) => `    ${renderPort(port)}`)].join("\n")
  return [head, info, ports].join("\n")
}

function renderPort(port: SerialAgentStatus["ports"][number]): string {
  const details =
    port.description ??
    (port.usb === undefined ? undefined : `USB ${port.usb.vendorId}:${port.usb.productId}`)
  const settings = port.settings === undefined ? "" : ` ${formatSerialSettings(port.settings)}`
  const state =
    port.usedBy === undefined
      ? port.usedElsewhere
        ? "open, in use by another session"
        : port.open
          ? "open"
          : "not open"
      : `open, used by ${port.usedBy}`
  return `${port.path}${details === undefined ? "" : ` (${details})`}${settings} ${state}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
