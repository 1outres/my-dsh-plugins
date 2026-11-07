import type { ReadResult } from "../../shared/types"

export const DEFAULT_READ_LIMIT = 2000

/** Split file text into lines, treating a final newline as a terminator. */
export function splitFileLines(content: string): string[] {
  if (content.length === 0) return []
  const lines = content.split("\n")
  if (lines.at(-1) === "") lines.pop()
  return lines
}

/** Window a file's lines the same way the built-in read tool does. */
export function sliceFileLines(
  content: string,
  path: string,
  offset = 1,
  limit = DEFAULT_READ_LIMIT,
): ReadResult {
  if (!Number.isInteger(offset) || offset < 1) throw new Error("offset must be a positive integer")
  if (!Number.isInteger(limit) || limit < 1) throw new Error("limit must be a positive integer")
  const lines = splitFileLines(content)
  const start = offset - 1
  const end = start + limit
  const window = lines.slice(start, end).map((text, index) => ({ number: start + index + 1, text }))
  return { path, offset, totalLines: lines.length, lines: window, truncated: end < lines.length }
}

export interface ReplaceResult {
  content: string
  replacements: number
}

/** Replace a literal string with the built-in edit tool's uniqueness rule. */
export function replaceLiteral(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): ReplaceResult {
  if (oldString.length === 0) throw new Error("old_string must not be empty")
  const count = countOccurrences(content, oldString)
  if (count === 0) throw new Error("old_string was not found in the file")
  if (count > 1 && !replaceAll)
    throw new Error(`old_string appears ${String(count)} times; make it unique or set replace_all`)
  return {
    content: replaceAll
      ? content.split(oldString).join(newString)
      : content.replace(oldString, newString),
    replacements: replaceAll ? count : 1,
  }
}

function countOccurrences(content: string, needle: string): number {
  let count = 0
  let index = content.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = content.indexOf(needle, index + needle.length)
  }
  return count
}
