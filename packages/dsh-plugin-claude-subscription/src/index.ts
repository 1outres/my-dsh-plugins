import { fileURLToPath } from "node:url"
import type { Context } from "@deepseek-ai/cordis"
import type { ImageAttachmentRef } from "@deepseek-ai/dsh-attachment"
import type { LlmConfigurableProvider } from "@deepseek-ai/dsh-llm"
import { ClaudeSubscriptionAdapter } from "./adapter"
import { Config, type ParsedConfig, readSettings } from "./config"
import { type NativeDeps, PROVIDER_ID } from "./contract"
import { runNative } from "./native/run"
import { discoverModels } from "./native/setup"
import { createRelay } from "./relay/relay"
import { type ImageAccess, imageRequestTarget } from "./request/images"
import { modelInfo } from "./request/model-info"
import { prepareRequest } from "./request/prepare"
import { projectionOf } from "./request/replay"

export { Config }
export const name = PROVIDER_ID
export const inject = ["llm", "subprocess"]

const DISPLAY_NAME = "Claude Subscription"

/** The DSH loader adds `entry`. Its types are not a dependency of this package. */
interface LoadedFiber {
  entry?: { options?: { id?: unknown } }
}

function settingsNamespace(ctx: Context): string {
  const id = (ctx.fiber as LoadedFiber).entry?.options?.id
  if (typeof id !== "string" || id === "") {
    throw new Error(
      `${PROVIDER_ID}: the loader gave this plugin no entry id, so its settings row cannot be found`,
    )
  }
  return id
}

/** The part of the DSH filesystem service that maps a host path into the world tools run in. */
interface ToolPathMapper {
  processPathFromHostPath(hostPath: string): string | undefined
}

function imageAccessOf(ctx: Context, ref: ImageAttachmentRef): ImageAccess | undefined {
  const hostPath = ctx.get("attachments")?.imageHostPath(ref)
  if (hostPath === undefined) return undefined
  const mapper = ctx.get("fs") as ToolPathMapper | undefined
  const readonlyPath = mapper?.processPathFromHostPath(hostPath)
  return readonlyPath === undefined ? undefined : { readonlyPath }
}

export function apply(ctx: Context, config: ParsedConfig): void {
  const native: NativeDeps = {
    subprocess: ctx.subprocess,
    createRelay,
    settings: () => readSettings(config),
    processEnv: () => process.env,
    inertMcpPath: fileURLToPath(new URL("./inert-mcp.js", import.meta.url)),
    nodePath: process.execPath,
  }
  const entry: LlmConfigurableProvider = {
    provider: PROVIDER_ID,
    displayName: DISPLAY_NAME,
    settingsNs: settingsNamespace(ctx),
    settingsPath: [],
  }
  const directory = ctx.llm.registerConfigurableProviders([entry])
  let reported: string | undefined

  ctx.llm.registerAdapter(
    [PROVIDER_ID],
    new ClaudeSubscriptionAdapter({
      prepare: (options) =>
        prepareRequest(options, {
          attachments: () => ctx.get("attachments"),
          imageAccess: (ref) => imageAccessOf(ctx, ref),
        }),
      run: runNative,
      discover: discoverModels,
      modelInfo,
      imageTarget: imageRequestTarget,
      projectionOf,
      native,
      reportDiscovery: (error) => {
        if (error === reported) return
        reported = error
        directory.replace([error === undefined ? entry : { ...entry, error }])
      },
      warn: (message) => ctx.logger.warn(message),
    }),
  )
}
