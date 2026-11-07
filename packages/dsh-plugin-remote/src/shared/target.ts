import type { RemoteTarget } from "./types"

/** Target names are short labels the model writes; the same name is the id. */
const TARGET_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/u

export function isValidTargetName(name: string): boolean {
  return TARGET_NAME.test(name)
}

export class TargetConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TargetConfigError"
  }
}

export type TargetFields = Pick<RemoteTarget, "name" | "host" | "user" | "port" | "jump">

/** Whitespace, quotes, or control characters break the shell and ssh argument words. */
function hasUnsafeCharacters(value: string): boolean {
  if (/[\s'"]/u.test(value)) return true
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/** Reject a name, host, user, port, or jump target the commands cannot take verbatim. */
export function assertTargetFields(target: TargetFields): void {
  if (!isValidTargetName(target.name)) {
    throw new TargetConfigError(
      "name must be 1 to 32 lowercase letters, digits, or hyphens, and must not start with a hyphen",
    )
  }
  if (target.host.length === 0 || hasUnsafeCharacters(target.host) || target.host.startsWith("-")) {
    throw new TargetConfigError(
      "host must be non-empty and must not contain spaces, control characters, or quotes, and must not start with a hyphen",
    )
  }
  if (
    target.user !== undefined &&
    (target.user.length === 0 ||
      hasUnsafeCharacters(target.user) ||
      target.user.includes("@") ||
      target.user.startsWith("-"))
  ) {
    throw new TargetConfigError(
      "user must not contain spaces, control characters, quotes, or @, and must not start with a hyphen",
    )
  }
  if (
    target.port !== undefined &&
    (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535)
  ) {
    throw new TargetConfigError("port must be an integer from 1 to 65535")
  }
  if (target.jump !== undefined && !isValidTargetName(target.jump)) {
    throw new TargetConfigError("jump must be an existing target name")
  }
  if (target.jump !== undefined && target.jump === target.name) {
    throw new TargetConfigError("jump must not name the target itself")
  }
}

/** Copy only present optional fields, so the value stays plain JSON. */
export function normalizeTarget(target: RemoteTarget): RemoteTarget {
  return {
    name: target.name,
    transport: "ssh",
    kind: target.kind,
    host: target.host,
    ...(target.user === undefined ? {} : { user: target.user }),
    ...(target.port === undefined ? {} : { port: target.port }),
    ...(target.jump === undefined ? {} : { jump: target.jump }),
    sshOptions: [...target.sshOptions],
    secrets: [...target.secrets],
    ...(target.promptPattern === undefined ? {} : { promptPattern: target.promptPattern }),
    initCommands: [...target.initCommands],
  }
}

/** A secret field name the model may name in a tool call. */
const SECRET_FIELD = /^[a-z][a-z0-9-]{0,31}$/u

export function isValidSecretField(name: string): boolean {
  return SECRET_FIELD.test(name)
}
