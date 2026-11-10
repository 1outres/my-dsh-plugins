import type { ParameterSchemaSpec, ValueSchemaSpec } from "@deepseek-ai/dsh-tools"

export const serialSettingsValueSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    baudRate: { type: "integer", required: true },
    dataBits: { type: "integer", required: true, enum: [5, 6, 7, 8] as const },
    parity: { type: "string", required: true, enum: ["none", "even", "odd"] as const },
    stopBits: { type: "integer", required: true, enum: [1, 2] as const },
    flowControl: { type: "string", required: true, enum: ["none", "rtscts", "xonxoff"] as const },
  },
} satisfies ValueSchemaSpec

const sshTargetValueSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", required: true },
    transport: { type: "string", required: true, enum: ["ssh"] as const },
    kind: { type: "string", required: true, enum: ["linux", "network"] as const },
    host: { type: "string", required: true },
    user: { type: "string" },
    port: { type: "integer" },
    jump: { type: "string" },
    sshOptions: { type: "array", required: true, items: { type: "string" } },
    secrets: { type: "array", required: true, items: { type: "string" } },
    promptPattern: { type: "string" },
    initCommands: { type: "array", required: true, items: { type: "string" } },
  },
} satisfies ValueSchemaSpec

const serialTargetValueSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", required: true },
    transport: { type: "string", required: true, enum: ["serial"] as const },
    kind: { type: "string", required: true, enum: ["linux", "network"] as const },
    agent: { type: "string", required: true },
    agentFingerprint: { type: "string", required: true },
    device: { type: "string", required: true },
    serial: { ...serialSettingsValueSchema, required: true },
    lineEnding: { type: "string", required: true, enum: ["cr", "lf", "crlf"] as const },
    secrets: { type: "array", required: true, items: { type: "string" } },
    promptPattern: { type: "string" },
    initCommands: { type: "array", required: true, items: { type: "string" } },
  },
} satisfies ValueSchemaSpec

export const targetValueSchema = {
  oneOf: [sshTargetValueSchema, serialTargetValueSchema],
} satisfies ValueSchemaSpec

export const serialUsbInfoValueSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    vendorId: { type: "string", required: true },
    productId: { type: "string", required: true },
    serialNumber: { type: "string" },
    manufacturer: { type: "string" },
    product: { type: "string" },
  },
} satisfies ValueSchemaSpec

export const serialPortInfoValueSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    path: { type: "string", required: true },
    description: { type: "string" },
    usb: serialUsbInfoValueSchema,
    open: { type: "boolean", required: true },
    settings: serialSettingsValueSchema,
    usedBy: { type: "string" },
    usedElsewhere: { type: "boolean", required: true },
  },
} satisfies ValueSchemaSpec

export const serialAgentInfoValueSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    version: { type: "string", required: true },
    hostname: { type: "string", required: true },
    os: { type: "string", required: true },
    arch: { type: "string", required: true },
  },
} satisfies ValueSchemaSpec

export const serialAgentStatusSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", required: true },
    fingerprint: { type: "string", required: true },
    online: { type: "boolean", required: true },
    info: serialAgentInfoValueSchema,
    ports: { type: "array", required: true, items: serialPortInfoValueSchema },
  },
} satisfies ValueSchemaSpec

export const sessionStatusSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string", required: true },
    target: { type: "string", required: true },
    name: { type: "string" },
    state: { type: "string", required: true, enum: ["open", "exited"] as const },
    exitCode: { type: "integer" },
  },
} satisfies ValueSchemaSpec

export const targetStatusSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    target: { ...targetValueSchema, required: true },
    connected: { type: "boolean", required: true },
    sessions: { type: "array", required: true, items: sessionStatusSchema },
    secretFields: {
      type: "array",
      required: true,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", required: true },
          present: { type: "boolean", required: true },
        },
      },
    },
  },
} satisfies ValueSchemaSpec

export const sessionBreakResultSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sessionId: { type: "string", required: true },
    durationMs: { type: "integer", required: true },
  },
} satisfies ValueSchemaSpec

export const execOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    exitCode: { oneOf: [{ type: "integer" }, { type: "null" }], required: true },
    stdout: { type: "string", required: true },
    stderr: { type: "string", required: true },
    timedOut: { type: "boolean", required: true },
    truncated: { type: "boolean", required: true },
  },
} satisfies ValueSchemaSpec

export const targetParameter = {
  type: "string",
  required: true,
  description: "Target name registered with remote_target_add.",
} satisfies ParameterSchemaSpec[string]

export const sudoParameter = {
  type: "boolean",
  description: "Run the command with sudo. Only Linux targets support sudo.",
} satisfies ParameterSchemaSpec[string]
