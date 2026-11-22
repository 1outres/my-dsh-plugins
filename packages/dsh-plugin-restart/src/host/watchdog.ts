/** Ends the process. */
export type ProcessExit = (code: number) => void

/**
 * End the process when the natural shutdown does not finish in time.
 *
 * Shutdown disposes the plugin context, and that clears every timer the
 * context owns, so this timer belongs to the process instead. After
 * `appExit` the launcher only sets the exit code, and one open handle (a log
 * file, a socket, a child process) then keeps a half-closed process alive
 * forever.
 * @param exit - ends the process.
 * @param code - exit code that asks the supervisor to start the Harness again.
 * @param delayMs - grace for the tree to dispose on its own.
 */
export function armExitWatchdog(exit: ProcessExit, code: number, delayMs: number): void {
  setTimeout(() => {
    exit(code)
  }, delayMs).unref()
}
