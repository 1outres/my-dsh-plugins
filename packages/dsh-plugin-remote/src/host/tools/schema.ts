import type { ParameterSchemaSpec, ValueSchemaSpec } from "@deepseek-ai/dsh-tools"

export const targetValueSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", required: true },
    transport: { type: "string", required: true, enum: ["ssh"] },
    kind: { type: "string", required: true, enum: ["linux", "network"] },
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

export const sessionStatusSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string", required: true },
    target: { type: "string", required: true },
    name: { type: "string" },
    state: { type: "string", required: true, enum: ["open", "exited"] },
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
