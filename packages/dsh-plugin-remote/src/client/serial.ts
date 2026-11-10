import type { SerialLineEnding } from "../shared/types"

const LINE_ENDING_KEY: Record<SerialLineEnding, string> = {
  cr: "lineEnding.cr",
  lf: "lineEnding.lf",
  crlf: "lineEnding.crlf",
}

/** The translation key of the name of the bytes the Enter key sends. */
export function lineEndingLabelKey(lineEnding: SerialLineEnding): string {
  return LINE_ENDING_KEY[lineEnding]
}
