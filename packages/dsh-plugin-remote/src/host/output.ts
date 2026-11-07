/** Keep the last bytes of output without splitting a UTF-8 code point. */
export function truncateTail(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.byteLength(text, "utf8")
  if (bytes <= maxBytes) return { text, truncated: false }
  const buffer = Buffer.from(text, "utf8")
  let start = buffer.length - maxBytes
  while (
    start < buffer.length &&
    (buffer[start] as number) >= 0x80 &&
    (buffer[start] as number) < 0xc0
  )
    start += 1
  return { text: buffer.subarray(start).toString("utf8"), truncated: true }
}

/** Replace every known secret value in text before it reaches the model. */
export function redactSecrets(text: string, secrets: Iterable<string>): string {
  const values = [...secrets]
    .filter((value) => value.length > 0)
    .sort((left, right) => right.length - left.length)
  let result = text
  for (const value of values) result = result.split(value).join("********")
  return result
}

/** Join stdout and stderr for one exec result without dropping the exit status. */
export function formatExecOutput(result: {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  truncated: boolean
}): string {
  const blocks: string[] = []
  if (result.timedOut) blocks.push("Command timed out.")
  if (result.exitCode !== null && result.exitCode !== 0)
    blocks.push(`Exit code: ${result.exitCode}`)
  else if (result.exitCode === null && !result.timedOut) blocks.push("Exit code: unknown")
  if (result.stdout.length > 0) blocks.push(result.stdout)
  if (result.stderr.length > 0) blocks.push(`stderr:\n${result.stderr}`)
  if (result.truncated) blocks.push("Output was truncated; the tail is shown.")
  return blocks.join("\n")
}
