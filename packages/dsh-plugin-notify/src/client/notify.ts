import type { NotifyConfig, PendingInteractionLike, SessionStatusMap } from "./types"

/** What a notification is about. */
export type NoticeKind = "approval" | "question" | "plan-review" | "completion"

/** One state change that deserves a notification. */
export interface NoticeEvent {
  readonly sessionId: string
  readonly kind: NoticeKind
  readonly key: string
  readonly toolName?: string
  readonly reason?: string
  readonly displayReason?: Readonly<Record<string, string>>
  readonly question?: string
}

/** A fully rendered notification, ready for the browser. */
export interface NoticeSpec {
  readonly tag: string
  readonly title: string
  readonly body: string
  readonly sessionId: string
}

/** What the page can see of itself; supplied by the caller so this stays pure. */
export interface PageState {
  readonly visible: boolean
  readonly focused: boolean
}

export interface DiffOptions {
  /** Notify for approval prompts. */
  approval: boolean
  /** Notify for questions and plan reviews. */
  question: boolean
  /** Notify when a turn stops running. */
  completion: boolean
  /** Restrict notifications to Sessions the sidebar shows. */
  notifySession?: (sessionId: string) => boolean
}

export interface StatusDiff {
  /** New notifications to raise. */
  opened: NoticeEvent[]
  /** Tags whose notification is no longer true. */
  closed: string[]
}

const FALLBACK_SESSION = "DeepSeek Harness"
const MAX_BODY = 180
const MAX_DETAIL = 140

const TITLES: Record<NoticeKind, string> = {
  approval: "Approval needed",
  question: "Question waiting",
  "plan-review": "Plan review waiting",
  completion: "Turn finished",
}

/** Map a pending interaction's discriminator onto the notification kinds. */
export function kindOf(pending: PendingInteractionLike): NoticeKind | undefined {
  switch (pending.kind) {
    case "approval":
      return "approval"
    case "question":
      return "question"
    case "plan-review":
      return "plan-review"
    default:
      return undefined
  }
}

/**
 * The tag shared by every notification about one Session and one concern.
 * A repeated notification with the same tag replaces the previous one instead
 * of stacking, and the tag is what a resolution closes.
 */
export function noticeTag(sessionId: string, kind: NoticeKind): string {
  return `dsh-notify:${kind}:${sessionId}`
}

/**
 * Compare two status snapshots and report what changed.
 *
 * A pending interaction notifies when it first appears or when its key changes
 * (the Host replayed a request over a new transport), and closes once the
 * interaction is gone. A completion notifies on a running-to-idle transition of
 * a Session already known to this page, so loading the page never replays a
 * backlog of finished turns.
 */
export function diffStatus(
  previous: SessionStatusMap | undefined,
  next: SessionStatusMap,
  options: DiffOptions,
): StatusDiff {
  const opened: NoticeEvent[] = []
  const closed: string[] = []
  const allowed = (sessionId: string) => options.notifySession?.(sessionId) ?? true
  const enabled = (kind: NoticeKind) =>
    kind === "approval"
      ? options.approval
      : kind === "completion"
        ? options.completion
        : options.question

  for (const [sessionId, status] of next) {
    const before = previous?.get(sessionId)
    const pending = status.pendingInteraction
    const previousPending = before?.pendingInteraction

    if (pending !== undefined) {
      const kind = kindOf(pending)
      const replaced = previousPending !== undefined && pending.key !== previousPending.key
      if (replaced && previousPending !== undefined) {
        const previousKind = kindOf(previousPending)
        if (previousKind !== undefined && previousKind !== kind) {
          closed.push(noticeTag(sessionId, previousKind))
        }
      }
      if (
        kind !== undefined &&
        pending.key !== previousPending?.key &&
        enabled(kind) &&
        allowed(sessionId)
      ) {
        opened.push({ sessionId, kind, key: pending.key, ...detailOf(pending) })
      }
    } else if (previousPending !== undefined) {
      const kind = kindOf(previousPending)
      if (kind !== undefined) closed.push(noticeTag(sessionId, kind))
    }

    if (before === undefined) continue
    const finished = before.running === true && status.running === false
    const becameUnread = before.completionUnread !== true && status.completionUnread === true
    if ((finished || becameUnread) && options.completion && allowed(sessionId)) {
      opened.push({ sessionId, kind: "completion", key: `completion:${sessionId}` })
    }
  }

  for (const [sessionId, before] of previous ?? []) {
    if (next.has(sessionId)) continue
    const kind =
      before.pendingInteraction === undefined ? undefined : kindOf(before.pendingInteraction)
    if (kind !== undefined) closed.push(noticeTag(sessionId, kind))
  }

  return { opened, closed }
}

/** Whether the current page state and settings allow a notification. */
export function shouldNotify(config: NotifyConfig, page: PageState): boolean {
  if (!config.enabled) return false
  if (config.onlyWhenUnfocused && page.visible && page.focused) return false
  return true
}

/** Render one event into the text the browser shows. */
export function formatNotice(
  event: NoticeEvent,
  sessionTitle: string,
  options: { showDetail: boolean },
): NoticeSpec {
  const session = truncate(sessionTitle, MAX_DETAIL) || FALLBACK_SESSION
  const detail = options.showDetail ? describe(event) : undefined
  const body = detail === undefined ? session : truncate(`${session} · ${detail}`, MAX_BODY)
  return {
    tag: noticeTag(event.sessionId, event.kind),
    title: TITLES[event.kind],
    body,
    sessionId: event.sessionId,
  }
}

/** Collapse whitespace and cut a hostile or oversized string down to size. */
export function truncate(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim()
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

function describe(event: NoticeEvent): string | undefined {
  const reason = event.displayReason?.en ?? event.reason
  switch (event.kind) {
    case "approval": {
      const parts = [event.toolName, reason].filter(
        (part): part is string => typeof part === "string" && part.trim().length > 0,
      )
      return parts.length === 0 ? undefined : truncate(parts.join(": "), MAX_DETAIL)
    }
    case "question":
      return event.question === undefined ? undefined : truncate(event.question, MAX_DETAIL)
    case "plan-review":
      return reason === undefined ? undefined : truncate(reason, MAX_DETAIL)
    case "completion":
      return undefined
  }
}

function detailOf(
  pending: PendingInteractionLike,
): Pick<NoticeEvent, "toolName" | "reason" | "displayReason" | "question"> {
  return {
    toolName: pending.toolName,
    reason: pending.reason,
    displayReason: pending.displayReason,
    question: pending.questions?.[0]?.question,
  }
}
