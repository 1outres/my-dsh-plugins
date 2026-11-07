import type { Context } from "@deepseek-ai/cordis"
import type { HostRuntime } from "../runtime"
import { registerExecTool } from "./exec"
import { registerFileTools } from "./files"
import { registerSessionTools } from "./sessions"
import { registerTargetTools } from "./targets"

/** Register the eleven remote_* tools on the plugin context. */
export function registerTools(ctx: Context, host: HostRuntime): void {
  registerTargetTools(ctx, host)
  registerExecTool(ctx, host)
  registerFileTools(ctx, host)
  registerSessionTools(ctx, host)
}
