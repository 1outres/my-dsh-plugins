import type { SessionEvent } from "@deepseek-ai/dsh-session"
import type { ProjectionDefinition } from "@deepseek-ai/dsh-session-projection"
import type { RemoteTargetsView } from "../../shared/types"
import { parseTargetMeta, targetsViewSchema } from "./schema"

export const REMOTE_TARGETS_KEY = "remoteTargets"

declare module "@deepseek-ai/dsh-session-projection/types" {
  interface SessionProjectionMap {
    /** Targets registered through `remote_target_add` and still present. */
    remoteTargets: RemoteTargetsView
  }
}

const EMPTY: RemoteTargetsView = { targets: [] }

type RemoteTargetsProjection = Omit<
  ProjectionDefinition<typeof REMOTE_TARGETS_KEY, RemoteTargetsView>,
  "wire"
> & {
  wire: NonNullable<ProjectionDefinition<typeof REMOTE_TARGETS_KEY, RemoteTargetsView>["wire"]>
}

/** Fold the durable target list from successful results and PTC dispatches. */
export const remoteTargetsProjection: RemoteTargetsProjection = {
  key: REMOTE_TARGETS_KEY,
  stateSchema: targetsViewSchema,
  stateVersion: 3,
  init: () => EMPTY,
  apply: (state, event) => {
    const meta = targetMetaOf(event)
    if (meta === undefined) return state
    if (meta.kind === "remote/target-added") {
      const without = state.targets.filter((target) => target.name !== meta.target.name)
      return { targets: [...without, meta.target] }
    }
    const remaining = state.targets.filter((target) => target.name !== meta.name)
    if (remaining.length === state.targets.length) return state
    return { targets: remaining }
  },
  wire: {
    viewSchema: targetsViewSchema,
    view: (state) => state,
  },
}

/**
 * Read the plugin's durable meta. A direct tool call records a tool result;
 * the programmatic caller records a dispatch event instead. The dispatch event
 * type is augmented by the PTC executor package, which is not in this plugin's
 * type graph, so the shape is read structurally.
 */
function targetMetaOf(event: SessionEvent): ReturnType<typeof parseTargetMeta> {
  if (event.type === "tool/result") {
    if (event.data.message.isError === true) return undefined
    return parseTargetMeta(event.data.meta)
  }
  const dispatch = event as unknown as {
    type: string
    data?: { isError?: boolean; meta?: unknown }
  }
  if (dispatch.type !== "tool/ptc-dispatch") return undefined
  if (dispatch.data?.isError === true) return undefined
  return parseTargetMeta(dispatch.data?.meta)
}
