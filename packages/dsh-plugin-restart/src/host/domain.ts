import { z } from "zod"

/** Stored shape of one resume request. */
export const resumeRequestSchema = z.object({
  sessionId: z.string().min(1),
  note: z.string().optional(),
  requestedAt: z.number().int().nonnegative(),
})

/** Durable record of the last restart. A bad record only loses one resume. */
export const RESTART_RESUME_DOMAIN = {
  name: "restart_resume",
  version: 1,
  invalidRecords: "backup-and-skip",
  tables: { requests: { valueSchema: resumeRequestSchema } },
} as const

/** The only key of the `requests` table: at most one restart is in flight. */
export const RESUME_KEY = "pending"
