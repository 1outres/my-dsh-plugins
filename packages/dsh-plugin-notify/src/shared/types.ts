/** Contracts shared by the Host and the browser half. */

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

/** A fully rendered notification, ready for a sink. */
export interface NoticeSpec {
  readonly tag: string
  readonly title: string
  readonly body: string
  readonly sessionId: string
}

/** Values persisted in the plugin's settings entry. */
export interface NotifyConfig {
  /** Master switch. Off shows no notification at all. */
  enabled: boolean
  /** Skip notifications while this page is visible and focused. */
  onlyWhenUnfocused: boolean
  /** Notify when a tool call waits for approval. */
  approval: boolean
  /** Notify when the agent asks a question or asks for a plan review. */
  question: boolean
  /** Notify when a turn stops running. */
  completion: boolean
  /** Add the request reason or question text to the body. */
  showDetail: boolean
  /** Let the Host send Web Push notifications to subscribed devices. */
  push: boolean
}

/**
 * The parts of a pending interaction the plugin reads. The shipped plugins
 * publish concrete classes (`PendingApproval`, `PendingQuestion`); only these
 * fields matter here, so the plugin depends on the shape instead of the
 * owning packages.
 */
export interface PendingInteractionLike {
  /** Request identity; a replacement request publishes a new key. */
  readonly key: string
  /** Presentation discriminator: approval, question, or plan-review. */
  readonly kind: string
  readonly sessionId?: string
  readonly toolName?: string
  readonly reason?: string
  readonly displayReason?: Readonly<Record<string, string>>
  readonly questions?: readonly { readonly question?: string; readonly header?: string }[]
}

/** One Session's status: the same shape `uiSession.sessionStatus` publishes. */
export interface SessionStatusLike {
  readonly running?: boolean
  readonly pendingInteraction?: PendingInteractionLike
  readonly completionUnread: boolean
}

export type SessionStatusMap = ReadonlyMap<string, SessionStatusLike>

/** What the page can see of itself; supplied by the caller so the logic stays pure. */
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
