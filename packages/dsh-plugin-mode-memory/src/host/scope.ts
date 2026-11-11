import { AsyncLocalStorage } from "node:async_hooks"
import type { CreateScope } from "../contract"

/**
 * Build the scope that marks one session.create call, so a preset selection
 * fired by the Host inside that call is not mistaken for a user choice.
 * @returns the scope shared by the interceptor and its callers.
 */
export function createCreateScope(): CreateScope {
  const storage = new AsyncLocalStorage<true>()
  return {
    run: (operation) => storage.run(true, operation),
    active: () => storage.getStore() === true,
  }
}
