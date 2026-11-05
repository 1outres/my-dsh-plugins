import type { NativeBlock } from "../../src/contract"
import {
  dropMessageBreakpoints,
  pinMessageBreakpoint,
  QueriedTurnMismatch,
  restoreQueriedTurn,
  stableRequestContext,
  streamToolInput,
} from "../../src/relay/rewrite"

export interface Rewritten {
  payload: Buffer
  /** Why the queried turn stayed as the CLI built it. Null when it was restored. */
  unrestored: string | null
}

/** The rewrites a relay applies to the admitted request, in the order it applies them. */
export function rewriteAsRelay(
  payload: Buffer,
  queried: readonly NativeBlock[],
  options: { oneShot?: boolean } = {},
): Rewritten {
  let current = options.oneShot === true ? dropMessageBreakpoints(payload) : payload
  let unrestored: string | null = null
  try {
    current = restoreQueriedTurn(current, queried)
  } catch (error) {
    if (!(error instanceof QueriedTurnMismatch)) throw error
    unrestored = error.message
  }
  current = stableRequestContext(current, queried)
  current = pinMessageBreakpoint(current, queried)
  current = streamToolInput(current)
  return { payload: current, unrestored }
}
