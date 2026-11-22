import type { PresetId } from "../contract"

/** The caller facts that decide whether an agent may ask for a restart. */
export interface CallerFacts {
  readonly agentId: string
  readonly rootAgentId: string
  readonly preset: PresetId | undefined
}

/** One live session whose agent is running. */
export interface RunningSession {
  readonly sessionId: string
  readonly title?: string
}

/**
 * Decide whether the restart tool may be offered to this agent.
 * @param facts - preset and tree position of the agent.
 * @param presets - preset ids that count as Creator mode.
 * @returns true only for a root agent in a Creator preset.
 */
export function isRestartOffered(facts: CallerFacts, presets: readonly PresetId[]): boolean {
  return (
    facts.rootAgentId === facts.agentId &&
    facts.preset !== undefined &&
    presets.includes(facts.preset)
  )
}

/**
 * Explain why this caller may not restart, or nothing when it may.
 * @param facts - preset and tree position of the agent.
 * @param presets - preset ids that count as Creator mode.
 * @returns the refusal message, or undefined for an admitted caller.
 */
export function callerRefusal(
  facts: CallerFacts,
  presets: readonly PresetId[],
): string | undefined {
  if (facts.rootAgentId !== facts.agentId) {
    return "A sub-agent cannot restart DeepSeek Harness; ask the root session to do it."
  }
  if (facts.preset === undefined) {
    return `restart_harness only works in a Creator session (${presets.join(", ")}); this session has no agent preset.`
  }
  if (!presets.includes(facts.preset)) {
    return `restart_harness only works in a Creator session (${presets.join(", ")}); this session uses the ${facts.preset} preset.`
  }
  return undefined
}

/**
 * Name the sessions that block a restart, one by one.
 * @param running - live sessions with a running agent.
 * @returns a comma-separated list of session ids, each with its title when known.
 */
export function describeRunningSessions(running: readonly RunningSession[]): string {
  return running
    .map((session) =>
      session.title === undefined
        ? session.sessionId
        : `${session.sessionId} (${JSON.stringify(session.title)})`,
    )
    .join(", ")
}

/**
 * Build the refusal of a restart that other running sessions block.
 * @param running - live sessions with a running agent.
 * @returns the message the model reads.
 */
export function runningRefusal(running: readonly RunningSession[]): string {
  return `Cannot restart DeepSeek Harness while other sessions are running: ${describeRunningSessions(running)}. Stop them first.`
}

/**
 * Build the message that tells the caller a queued restart was cancelled.
 * @param running - live sessions that started running meanwhile.
 * @returns the follow-up text.
 */
export function cancelledMessage(running: readonly RunningSession[]): string {
  return `DeepSeek Harness did not restart: another session started running, so the restart was cancelled. Running sessions: ${describeRunningSessions(running)}. Ask again when they are idle.`
}
