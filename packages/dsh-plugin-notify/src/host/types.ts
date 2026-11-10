/** Host contracts this plugin reads, mirrored from the Harness packages that own them. */

export type ApprovalOutcomeLike = "allowed-once" | "rejected" | "cancelled" | "unavailable"

export interface ApprovalRequestLike {
  readonly agent: { readonly id: string }
  readonly toolName: string
  readonly callId?: string
  readonly reason?: string
  readonly displayReason?: Readonly<Record<string, string>>
  readonly signal?: unknown
}

export interface QuestionIntentLike {
  readonly kind?: string
}

export interface QuestionItemLike {
  readonly question?: string
  readonly header?: string
  readonly intent?: QuestionIntentLike
}

export interface QuestionRequestLike {
  readonly questions?: readonly QuestionItemLike[]
  readonly agent?: { readonly id: string }
  readonly signal?: unknown
  readonly wait?: { readonly callId?: string; readonly timed?: boolean }
}

/** The Host answers with its own shape; the watcher only passes it through. */
export type QuestionAnswerLike = unknown

/** Events the Host watcher observes. */
export interface HostEvents {
  "api-session/status": (sessionId: string, running: boolean) => void
  "api-session/removed": (sessionId: string) => void
  "approval/request": (
    request: ApprovalRequestLike,
    next: () => Promise<ApprovalOutcomeLike>,
  ) => Promise<ApprovalOutcomeLike>
  "user-questions/request": (
    request: QuestionRequestLike,
    next: () => Promise<QuestionAnswerLike>,
  ) => Promise<QuestionAnswerLike>
}

export interface SessionHeaderLike {
  readonly origin?: "subagent"
}

export interface SessionLike {
  readonly id: string
  readonly header: SessionHeaderLike
}

export interface SessionTitleSnapshotLike {
  readonly title: string
}

export interface LoggerLike {
  warn(message: string): void
}
