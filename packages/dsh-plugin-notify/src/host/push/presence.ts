/** How long one presence report stays relevant. */
export const PRESENCE_TTL_MS = 75_000

export interface PresenceReport {
  readonly visible: boolean
  readonly focused: boolean
  readonly at: number
}

/** Whether one subscription's page is watching right now. */
export interface PresenceLike {
  isAttended(endpoint: string, now: number): boolean
}

/** Presence reported by each subscribed browser, held in Host memory only. */
export class Presence implements PresenceLike {
  readonly #reports = new Map<string, PresenceReport>()

  report(
    endpoint: string,
    state: { readonly visible: boolean; readonly focused: boolean },
    now: number,
  ): void {
    this.#reports.set(endpoint, { visible: state.visible, focused: state.focused, at: now })
  }

  isAttended(endpoint: string, now: number): boolean {
    const report = this.#reports.get(endpoint)
    if (report === undefined) return false
    if (!report.visible || !report.focused) return false
    return now - report.at < PRESENCE_TTL_MS
  }

  forget(endpoint: string): void {
    this.#reports.delete(endpoint)
  }
}
