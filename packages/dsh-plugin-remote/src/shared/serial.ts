import type { SerialLineEnding, SerialParity, SerialSettings } from "./types"

/** The settings most network device consoles use. */
export const DEFAULT_SERIAL_SETTINGS: SerialSettings = {
  baudRate: 9600,
  dataBits: 8,
  parity: "none",
  stopBits: 1,
  flowControl: "none",
}

export const DEFAULT_SERIAL_LINE_ENDING: SerialLineEnding = "cr"

const PARITY_LETTER: Record<SerialParity, string> = { none: "N", even: "E", odd: "O" }

const LINE_ENDING_BYTES: Record<SerialLineEnding, string> = { cr: "\r", lf: "\n", crlf: "\r\n" }

/** Short form such as "9600 8N1" or "115200 7E2 rtscts". */
export function formatSerialSettings(settings: SerialSettings): string {
  const frame = `${String(settings.dataBits)}${PARITY_LETTER[settings.parity]}${String(settings.stopBits)}`
  const flow = settings.flowControl === "none" ? "" : ` ${settings.flowControl}`
  return `${String(settings.baudRate)} ${frame}${flow}`
}

/** The bytes one Enter key sends for a line ending setting. */
export function lineEndingBytes(lineEnding: SerialLineEnding): string {
  return LINE_ENDING_BYTES[lineEnding]
}
