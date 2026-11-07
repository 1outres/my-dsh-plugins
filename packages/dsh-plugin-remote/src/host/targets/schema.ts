import { z } from "zod"
import type { RemoteTarget, RemoteTargetsView } from "../../shared/types"

export const targetSchema = z.object({
  name: z.string(),
  transport: z.literal("ssh"),
  kind: z.union([z.literal("linux"), z.literal("network")]),
  host: z.string(),
  user: z.string().optional(),
  port: z.number().optional(),
  jump: z.string().optional(),
  sshOptions: z.array(z.string()),
  secrets: z.array(z.string()),
  promptPattern: z.string().optional(),
  initCommands: z.array(z.string()),
})

export const targetsViewSchema = z.object({
  targets: z.array(targetSchema),
})

export const targetMetaSchema = z.union([
  z.object({ kind: z.literal("remote/target-added"), target: targetSchema }),
  z.object({ kind: z.literal("remote/target-removed"), name: z.string() }),
])

export type TargetMeta = z.infer<typeof targetMetaSchema>

/** Parse durable meta written by this plugin; anything else is ignored. */
export function parseTargetMeta(value: unknown): TargetMeta | undefined {
  const parsed = targetMetaSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

/** Narrow a stored target back to the shared contract. */
export function toTarget(value: z.infer<typeof targetSchema>): RemoteTarget {
  return value as RemoteTarget
}

export function targetsOf(state: RemoteTargetsView): RemoteTarget[] {
  return state.targets.map(toTarget)
}
