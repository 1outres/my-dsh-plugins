/** Message of an unknown thrown value, for logs. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
