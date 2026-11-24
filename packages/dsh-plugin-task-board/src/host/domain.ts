import { z } from "zod"

const authorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user") }),
  z.object({ kind: z.literal("agent"), sessionId: z.string().min(1) }),
])

const columnTitleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("preset"), preset: z.enum(["todo", "in_progress", "done"]) }),
  z.object({ kind: z.literal("text"), text: z.string().min(1) }),
])

const columnSchema = z.object({
  id: z.string().min(1),
  title: columnTitleSchema,
  cardNumbers: z.array(z.number().int().positive()),
})

export const boardSchema = z.object({
  project: z.string().min(1),
  columns: z.array(columnSchema).min(1),
  nextCardNumber: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

const commentSchema = z.object({
  id: z.string().min(1),
  author: authorSchema,
  body: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
})

export const cardSchema = z.object({
  project: z.string().min(1),
  number: z.number().int().positive(),
  title: z.string().min(1),
  description: z.string(),
  comments: z.array(commentSchema),
  sessionIds: z.array(z.string().min(1)),
  createdBy: authorSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export const TASK_BOARD_DOMAIN = {
  name: "task_board",
  version: 1,
  layout: "per-record",
  tables: {
    boards: { valueSchema: boardSchema },
    cards: { valueSchema: cardSchema },
  },
} as const
