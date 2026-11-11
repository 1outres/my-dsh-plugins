import { z } from "zod"

/** Stored shape of one remembered choice. */
export const rememberedModeSchema = z.object({
  agentPreset: z.string().min(1),
  updatedAt: z.number().int().nonnegative(),
})

/** Durable per-project memory. A bad record only loses a convenience. */
export const MODE_MEMORY_DOMAIN = {
  name: "mode_memory",
  version: 1,
  invalidRecords: "backup-and-skip",
  tables: { projects: { valueSchema: rememberedModeSchema } },
} as const
