import type {
  RemoteTarget,
  SerialFlowControl,
  SerialLineEnding,
  SerialParity,
  SerialSettings,
  SerialTarget,
  SshTarget,
} from "./types"

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

export type TargetFields = Pick<SshTarget, "name" | "host" | "user" | "port" | "jump">

export type SerialTargetFields = Pick<
  SerialTarget,
  "name" | "agent" | "device" | "serial" | "lineEnding"
>

const DATA_BITS = [5, 6, 7, 8] as const
const STOP_BITS = [1, 2] as const
const PARITIES: readonly SerialParity[] = ["none", "even", "odd"]
const FLOW_CONTROLS: readonly SerialFlowControl[] = ["none", "rtscts", "xonxoff"]
const LINE_ENDINGS: readonly SerialLineEnding[] = ["cr", "lf", "crlf"]

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
  assertName(target.name)
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

/** Reject an agent name, device path, or line setting the agent cannot take. */
export function assertSerialTargetFields(target: SerialTargetFields): void {
  assertName(target.name)
  if (!isValidTargetName(target.agent)) {
    throw new TargetConfigError(
      "agent must name an entry in serialAgents: 1 to 32 lowercase letters, digits, or hyphens",
    )
  }
  if (
    target.device.length === 0 ||
    target.device.length > 256 ||
    !target.device.startsWith("/") ||
    hasUnsafeCharacters(target.device)
  ) {
    throw new TargetConfigError(
      "device must be an absolute path of at most 256 characters and must not contain spaces, control characters, or quotes",
    )
  }
  assertSerialSettings(target.serial)
  if (!LINE_ENDINGS.includes(target.lineEnding)) {
    throw new TargetConfigError("lineEnding must be one of cr, lf, or crlf")
  }
}

function assertSerialSettings(settings: SerialSettings): void {
  if (
    !Number.isInteger(settings.baudRate) ||
    settings.baudRate < 50 ||
    settings.baudRate > 4_000_000
  ) {
    throw new TargetConfigError("baudRate must be an integer from 50 to 4000000")
  }
  if (!(DATA_BITS as readonly number[]).includes(settings.dataBits)) {
    throw new TargetConfigError("dataBits must be 5, 6, 7, or 8")
  }
  if (!PARITIES.includes(settings.parity)) {
    throw new TargetConfigError("parity must be none, even, or odd")
  }
  if (!(STOP_BITS as readonly number[]).includes(settings.stopBits)) {
    throw new TargetConfigError("stopBits must be 1 or 2")
  }
  if (!FLOW_CONTROLS.includes(settings.flowControl)) {
    throw new TargetConfigError("flowControl must be none, rtscts, or xonxoff")
  }
}

function assertName(name: string): void {
  if (!isValidTargetName(name)) {
    throw new TargetConfigError(
      "name must be 1 to 32 lowercase letters, digits, or hyphens, and must not start with a hyphen",
    )
  }
}

/** Copy only present optional fields, so the value stays plain JSON. */
export function normalizeTarget(target: RemoteTarget): RemoteTarget {
  if (target.transport === "ssh") {
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
  return {
    name: target.name,
    transport: "serial",
    kind: target.kind,
    agent: target.agent,
    agentFingerprint: target.agentFingerprint,
    device: target.device,
    serial: {
      baudRate: target.serial.baudRate,
      dataBits: target.serial.dataBits,
      parity: target.serial.parity,
      stopBits: target.serial.stopBits,
      flowControl: target.serial.flowControl,
    },
    lineEnding: target.lineEnding,
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
