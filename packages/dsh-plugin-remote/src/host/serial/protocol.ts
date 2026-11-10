import { z } from "zod"

/** The wire protocol number both sides must agree on. */
export const SERIAL_PROTOCOL_VERSION = 1

/** One WebSocket frame may not be larger than this. */
export const SERIAL_MAX_FRAME_BYTES = 1 << 20

/** Largest byte count one port.write may carry. */
export const SERIAL_MAX_WRITE_BYTES = 64 * 1024

export const SERIAL_HANDSHAKE_TIMEOUT_MS = 10_000
export const SERIAL_HEARTBEAT_INTERVAL_MS = 20_000
export const SERIAL_HEARTBEAT_TIMEOUT_MS = 60_000

/** Close codes from PROTOCOL.md. */
export const SERIAL_CLOSE = {
  normal: 1000,
  protocol: 4400,
  auth: 4401,
  unknownKey: 4403,
  handshakeTimeout: 4408,
  replaced: 4409,
} as const

export type SerialCloseCode = (typeof SERIAL_CLOSE)[keyof typeof SERIAL_CLOSE]

export const SERIAL_ERROR_CODES = [
  "invalid-params",
  "unknown-method",
  "not-allowed",
  "not-found",
  "busy",
  "unknown-handle",
  "unsupported",
  "io",
] as const

export type SerialErrorCode = (typeof SERIAL_ERROR_CODES)[number]

export const SERIAL_REJECTION_CODES = ["protocol", "unknown-key", "bad-signature"] as const

export type SerialRejectionCode = (typeof SERIAL_REJECTION_CODES)[number]

export const SERIAL_PORT_CLOSE_REASONS = ["device-removed", "io-error", "orphan-timeout"] as const

export type SerialPortCloseReason = (typeof SERIAL_PORT_CLOSE_REASONS)[number]

export const SERIAL_METHODS = [
  "ports.list",
  "port.open",
  "port.subscribe",
  "port.unsubscribe",
  "port.write",
  "port.break",
  "port.close",
] as const

export type SerialMethod = (typeof SERIAL_METHODS)[number]

export const serialSettingsSchema = z.strictObject({
  baudRate: z.number().int().positive(),
  dataBits: z.union([z.literal(5), z.literal(6), z.literal(7), z.literal(8)]),
  parity: z.enum(["none", "even", "odd"]),
  stopBits: z.union([z.literal(1), z.literal(2)]),
  flowControl: z.enum(["none", "rtscts", "xonxoff"]),
})

export const serialUsbInfoSchema = z.strictObject({
  vendorId: z.string().regex(/^[0-9a-f]{4}$/u),
  productId: z.string().regex(/^[0-9a-f]{4}$/u),
  serialNumber: z.string().optional(),
  manufacturer: z.string().optional(),
  product: z.string().optional(),
})

export const wirePortInfoSchema = z.strictObject({
  path: z.string().min(1),
  description: z.string().optional(),
  usb: serialUsbInfoSchema.optional(),
  open: z.boolean(),
  handle: z.string().min(1).optional(),
  settings: serialSettingsSchema.optional(),
})

export const serialAgentInfoSchema = z.strictObject({
  version: z.string(),
  hostname: z.string(),
  os: z.string(),
  arch: z.string(),
})

export const challengeFrameSchema = z.strictObject({
  type: z.literal("challenge"),
  protocol: z.literal(SERIAL_PROTOCOL_VERSION),
  nonce: z.base64(),
})

export const authFrameSchema = z.strictObject({
  type: z.literal("auth"),
  protocol: z.number().int().positive(),
  publicKey: z.base64(),
  signature: z.base64(),
  agent: serialAgentInfoSchema,
})

export const welcomeFrameSchema = z.strictObject({
  type: z.literal("welcome"),
  name: z.string(),
})

export const rejectedFrameSchema = z.strictObject({
  type: z.literal("rejected"),
  code: z.enum(SERIAL_REJECTION_CODES),
  message: z.string(),
})

export const requestFrameSchema = z.strictObject({
  type: z.literal("request"),
  id: z.number().int().positive(),
  method: z.enum(SERIAL_METHODS),
  params: z.unknown(),
})

export const responseErrorSchema = z.strictObject({
  code: z.enum(SERIAL_ERROR_CODES),
  message: z.string(),
})

export const responseFrameSchema = z.union([
  z.strictObject({
    type: z.literal("response"),
    id: z.number().int().positive(),
    result: z.unknown(),
  }),
  z.strictObject({
    type: z.literal("response"),
    id: z.number().int().positive(),
    error: responseErrorSchema,
  }),
])

export const dataEventSchema = z.strictObject({
  type: z.literal("event"),
  event: z.literal("data"),
  handle: z.string().min(1),
  offset: z.number().int().nonnegative(),
  data: z.base64(),
})

export const closedEventSchema = z.strictObject({
  type: z.literal("event"),
  event: z.literal("closed"),
  handle: z.string().min(1),
  reason: z.enum(SERIAL_PORT_CLOSE_REASONS),
  message: z.string().default(""),
})

export const eventFrameSchema = z.union([dataEventSchema, closedEventSchema])

export const agentFrameSchema = z.union([responseFrameSchema, eventFrameSchema])

export const serverFrameSchema = z.union([
  challengeFrameSchema,
  welcomeFrameSchema,
  rejectedFrameSchema,
  requestFrameSchema,
])

const emptyParamsSchema = z.strictObject({})

const emptyResultSchema = z.strictObject({})

export const portsListParamsSchema = emptyParamsSchema

export const portsListResultSchema = z.strictObject({
  ports: z.array(wirePortInfoSchema),
})

export const portOpenParamsSchema = z.strictObject({
  path: z.string().min(1),
  settings: serialSettingsSchema,
})

export const portOpenResultSchema = z
  .strictObject({
    handle: z.string().min(1),
    reused: z.boolean(),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  })
  .refine((value) => value.start <= value.end, {
    message: "port.open start must not be past end",
  })

export const portSubscribeParamsSchema = z.strictObject({
  handle: z.string().min(1),
  from: z.number().int().nonnegative(),
})

export const portSubscribeResultSchema = z.strictObject({
  from: z.number().int().nonnegative(),
  lost: z.number().int().nonnegative(),
})

export const portUnsubscribeParamsSchema = z.strictObject({
  handle: z.string().min(1),
})

export const portWriteParamsSchema = z.strictObject({
  handle: z.string().min(1),
  data: z.base64(),
})

export const portWriteResultSchema = z.strictObject({
  written: z.number().int().nonnegative(),
})

export const portBreakParamsSchema = z.strictObject({
  handle: z.string().min(1),
  durationMs: z.number().int().min(1).max(5000),
})

export const portCloseParamsSchema = z.strictObject({
  handle: z.string().min(1),
})

export const serialMethodSchemas = {
  "ports.list": { params: portsListParamsSchema, result: portsListResultSchema },
  "port.open": { params: portOpenParamsSchema, result: portOpenResultSchema },
  "port.subscribe": { params: portSubscribeParamsSchema, result: portSubscribeResultSchema },
  "port.unsubscribe": { params: portUnsubscribeParamsSchema, result: emptyResultSchema },
  "port.write": { params: portWriteParamsSchema, result: portWriteResultSchema },
  "port.break": { params: portBreakParamsSchema, result: emptyResultSchema },
  "port.close": { params: portCloseParamsSchema, result: emptyResultSchema },
} as const

export type SerialParams<M extends SerialMethod> = z.infer<
  (typeof serialMethodSchemas)[M]["params"]
>

export type SerialResult<M extends SerialMethod> = z.infer<
  (typeof serialMethodSchemas)[M]["result"]
>

export type ChallengeFrame = z.infer<typeof challengeFrameSchema>
export type AuthFrame = z.infer<typeof authFrameSchema>
export type WelcomeFrame = z.infer<typeof welcomeFrameSchema>
export type RejectedFrame = z.infer<typeof rejectedFrameSchema>
export type RequestFrame = z.infer<typeof requestFrameSchema>
export type ResponseFrame = z.infer<typeof responseFrameSchema>
export type DataEventFrame = z.infer<typeof dataEventSchema>
export type ClosedEventFrame = z.infer<typeof closedEventSchema>
export type EventFrame = z.infer<typeof eventFrameSchema>
export type AgentFrame = z.infer<typeof agentFrameSchema>
export type ServerFrame = z.infer<typeof serverFrameSchema>
export type SerialFrame = ServerFrame | AgentFrame | AuthFrame
export type WirePortInfo = z.infer<typeof wirePortInfoSchema>

export class SerialProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SerialProtocolError"
  }
}

/** Encode one frame as the JSON text of a WebSocket text frame. */
export function encodeFrame(frame: SerialFrame): string {
  return JSON.stringify(frame)
}

export function parseServerFrame(text: string): ServerFrame {
  return parseFrame(serverFrameSchema, text, "server frame")
}

export function parseHandshakeFrame(text: string): AuthFrame {
  return parseFrame(authFrameSchema, text, "auth frame")
}

export function parseAgentFrame(text: string): AgentFrame {
  return parseFrame(agentFrameSchema, text, "agent frame")
}

function parseFrame<T>(schema: z.ZodType<T>, text: string, label: string): T {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new SerialProtocolError(`The ${label} is not valid JSON`)
  }
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map(
        (issue) => `${issue.path.length === 0 ? "frame" : issue.path.join(".")}: ${issue.message}`,
      )
      .join("; ")
    throw new SerialProtocolError(`Invalid ${label}: ${detail}`)
  }
  return parsed.data
}
