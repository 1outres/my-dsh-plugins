import type { SessionEvent, SessionEventEntry } from "./types"

/**
 * Where to cut the source log so the fork holds everything before one turn.
 *
 * - `cut`: fork through this inclusive event seq.
 * - `load`: the loaded window is too short; page history through `through`
 *   and ask again.
 * - `invalid`: the log has no clean cut before this turn.
 */
export type ForkBoundary =
  | { kind: "cut"; seq: number }
  | { kind: "load"; through: number }
  | { kind: "invalid" }

/**
 * Keep the durable events of a Session event window, in log order.
 * @param entries - the window's entries, including client-only live chunks.
 * @returns durable events only.
 */
export function durableEvents(entries: readonly SessionEventEntry[]): SessionEvent[] {
  const events: SessionEvent[] = []
  for (const entry of entries) if (entry.type === "event") events.push(entry.event)
  return events
}

/** Events that begin the next exchange: the cut must stop before them. */
function opensExchange(event: SessionEvent): boolean {
  if (event.type === "turn/start" || event.type === "agent/inbox/spliced") return true
  // Compaction checkpoints replace earlier messages and stay with the prefix.
  return event.type === "user/message" && event.surfaceOp === "append"
}

/**
 * Find the fork boundary for editing the prompt that opens `turn`. This is
 * the Host's own "latest completed turn" rule applied to the previous turn:
 * start at its `turn/end` and extend over the standalone events after it
 * (changed files, titles, model choices, commands) until the next exchange
 * begins. For the first turn, the walk starts at the beginning of the log and
 * keeps only the Session's setup events.
 * @param events - the loaded durable window, in log order.
 * @param turn - turn number the edited prompt opens.
 * @param turnStartSeq - seq of that turn's `turn/start`.
 * @returns the cut, a request to load older history, or invalid.
 */
export function forkBoundary(
  events: readonly SessionEvent[],
  turn: number,
  turnStartSeq: number,
): ForkBoundary {
  const first = events[0]
  if (first === undefined || first.seq > turnStartSeq) {
    return { kind: "load", through: Math.max(0, turnStartSeq - 1) }
  }

  let anchor: number | undefined
  for (const event of events) {
    if (event.seq >= turnStartSeq) break
    if (event.type === "turn/end") anchor = event.seq
  }

  if (anchor === undefined) {
    if (first.seq > 0) {
      const through = first.seq > turnStartSeq - 1 ? turnStartSeq - 1 : 0
      return { kind: "load", through: Math.max(0, through) }
    }
    // The whole log before this turn is loaded and no turn ended in it.
    if (turn > 1) return { kind: "invalid" }
    anchor = -1
  }

  let cut = anchor
  for (const event of events) {
    if (event.seq <= anchor) continue
    if (event.seq >= turnStartSeq || opensExchange(event)) break
    cut = event.seq
  }
  return cut < 0 ? { kind: "invalid" } : { kind: "cut", seq: cut }
}
