import type { Context } from "@deepseek-ai/cordis"
import type { Agent } from "@deepseek-ai/dsh-agent"
import type { ToolRunContext } from "@deepseek-ai/dsh-tools"
import type { RemoteTarget } from "../../shared/types"
import { type HostRuntime, type RootRuntime, resolveRootAgent } from "../runtime"

export function requireAgent(exec: ToolRunContext): Agent {
  if (exec.agent === undefined) throw new Error("This tool needs a live agent session")
  return exec.agent
}

export interface ToolRuntime {
  runtime: RootRuntime
  agent: Agent
  delegated: boolean
}

export function runtimeFor(ctx: Context, host: HostRuntime, exec: ToolRunContext): ToolRuntime {
  const agent = requireAgent(exec)
  const root = resolveRootAgent(ctx, agent)
  return { runtime: host.runtimeFor(root), agent, delegated: root.id !== agent.id }
}

export function requireUserCard(runtime: RootRuntime, agent: Agent): void {
  if (runtime.root.id !== agent.id) {
    throw new Error(
      "A sub-agent cannot wait for the user; ask the root session to register the target or enter the password",
    )
  }
}

export function requireFileCapability(runtime: RootRuntime, target: RemoteTarget): void {
  if (!runtime.transportFor(target).capabilities(target).files) {
    throw new Error(
      `File tools need the ssh transport; target ${JSON.stringify(target.name)} uses the ${target.transport} transport`,
    )
  }
}

export function requireExecCapability(runtime: RootRuntime, target: RemoteTarget): void {
  if (!runtime.transportFor(target).capabilities(target).exec) {
    throw new Error(
      `The ${target.transport} transport has no one-shot commands; target ${JSON.stringify(target.name)} only supports interactive sessions`,
    )
  }
}

export function requireSudoCapability(
  runtime: RootRuntime,
  target: RemoteTarget,
  sudo: boolean,
): void {
  if (sudo && !runtime.transportFor(target).capabilities(target).sudo) {
    throw new Error(
      `sudo is not available on the ${target.transport} target ${JSON.stringify(target.name)}`,
    )
  }
}

export function timeoutOf(value: number | undefined, fallback: number, maximum: number): number {
  const timeout = value ?? fallback
  if (!Number.isInteger(timeout) || timeout <= 0)
    throw new Error("timeoutMs must be a positive integer")
  return Math.min(timeout, maximum)
}

export function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback
  if (!Number.isInteger(result) || result <= 0)
    throw new Error(`${name} must be a positive integer`)
  return result
}

/** Keep rendered tool text below the configured size while keeping its head. */
export function clipHead(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text
  const slice = Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8")
  return `${slice}\n[output truncated]`
}
