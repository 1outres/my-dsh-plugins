import type {
  NoticeKind,
  PendingInteractionLike,
  SessionStatusLike,
  SessionStatusMap,
} from "../shared/types"
import type {
  ApprovalOutcomeLike,
  ApprovalRequestLike,
  HostEvents,
  QuestionAnswerLike,
  QuestionRequestLike,
  SessionLike,
  SessionTitleSnapshotLike,
} from "./types"

/** The Host services and events the watcher reads. */
export interface WatcherContext {
  readonly sessions: { get(id: string): SessionLike | undefined }
  readonly sessionTitle: { get(session: SessionLike): SessionTitleSnapshotLike | undefined }
  on<K extends keyof HostEvents>(event: K, listener: HostEvents[K]): () => void
}

interface PendingEntry extends PendingInteractionLike {
  readonly sessionId: string
  readonly openedAt: number
}

interface StatusEntry {
  running?: boolean
  readonly pending: PendingEntry[]
}

export interface SessionStatusSource {
  getSnapshot(): SessionStatusMap
  subscribe(listener: () => void): () => void
  titleOf(sessionId: string): string
}

/**
 * Host-side status source. It publishes the same shape the browser half gets
 * from `uiSession.sessionStatus`, so the notification diff logic is shared.
 *
 * Approval and question requests are observed as pass-through waterfall
 * listeners: they record the request, call `next()`, and return its result
 * unchanged. The watcher never answers, delays, or replaces a request.
 */
export class SessionStatusWatcher implements SessionStatusSource {
  readonly #ctx: WatcherContext
  readonly #now: () => number
  readonly #statuses = new Map<string, StatusEntry>()
  readonly #listeners = new Set<() => void>()
  #snapshot: SessionStatusMap = new Map()
  #counter = 0

  constructor(ctx: WatcherContext, options: { readonly now?: () => number } = {}) {
    this.#ctx = ctx
    this.#now = options.now ?? Date.now
  }

  attach(): () => void {
    const disposers = [
      this.#ctx.on("api-session/status", (sessionId, running) => {
        if (!this.#isTopLevel(sessionId)) return
        const entry = this.#entry(sessionId)
        entry.running = running
        this.#publish()
      }),
      this.#ctx.on("api-session/removed", (sessionId) => {
        if (!this.#statuses.delete(sessionId)) return
        this.#publish()
      }),
      this.#ctx.on("approval/request", (request, next) => this.#approval(request, next)),
      this.#ctx.on("user-questions/request", (request, next) => this.#question(request, next)),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  }

  getSnapshot(): SessionStatusMap {
    return this.#snapshot
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /** Latest title of a live Session, or an empty string when it is not live. */
  titleOf(sessionId: string): string {
    const session = this.#ctx.sessions.get(sessionId)
    if (session === undefined) return ""
    return this.#ctx.sessionTitle.get(session)?.title ?? ""
  }

  async #approval(
    request: ApprovalRequestLike,
    next: () => Promise<ApprovalOutcomeLike>,
  ): Promise<ApprovalOutcomeLike> {
    const sessionId = request.agent.id
    if (!this.#isTopLevel(sessionId)) return next()
    const key = `approval:${request.callId ?? `#${++this.#counter}`}`
    this.#open(sessionId, {
      key,
      kind: "approval",
      sessionId,
      openedAt: this.#now(),
      toolName: request.toolName,
      reason: request.reason,
      displayReason: request.displayReason,
    })
    try {
      return await next()
    } finally {
      this.#close(sessionId, key)
    }
  }

  async #question(
    request: QuestionRequestLike,
    next: () => Promise<QuestionAnswerLike>,
  ): Promise<QuestionAnswerLike> {
    const sessionId = request.agent?.id
    if (typeof sessionId !== "string" || !this.#isTopLevel(sessionId)) return next()
    const questions = request.questions ?? []
    const key = `question:${request.wait?.callId ?? `#${++this.#counter}`}`
    this.#open(sessionId, {
      key,
      kind: kindOfIntent(questions[0]?.intent?.kind),
      sessionId,
      openedAt: this.#now(),
      questions: questions.map((item) => ({ question: item.question, header: item.header })),
    })
    try {
      return await next()
    } finally {
      this.#close(sessionId, key)
    }
  }

  #open(sessionId: string, entry: PendingEntry): void {
    this.#entry(sessionId).pending.push(entry)
    this.#publish()
  }

  #close(sessionId: string, key: string): void {
    const entry = this.#statuses.get(sessionId)
    if (entry === undefined) return
    const index = entry.pending.findIndex((item) => item.key === key)
    if (index === -1) return
    entry.pending.splice(index, 1)
    this.#publish()
  }

  #entry(sessionId: string): StatusEntry {
    const existing = this.#statuses.get(sessionId)
    if (existing !== undefined) return existing
    const entry: StatusEntry = { pending: [] }
    this.#statuses.set(sessionId, entry)
    return entry
  }

  #isTopLevel(sessionId: string): boolean {
    return this.#ctx.sessions.get(sessionId)?.header.origin !== "subagent"
  }

  #publish(): void {
    const next = new Map<string, SessionStatusLike>()
    for (const [sessionId, entry] of this.#statuses) {
      const latest = entry.pending[entry.pending.length - 1]
      next.set(sessionId, {
        running: entry.running,
        pendingInteraction:
          latest === undefined
            ? undefined
            : {
                key: latest.key,
                kind: latest.kind,
                sessionId: latest.sessionId,
                toolName: latest.toolName,
                reason: latest.reason,
                displayReason: latest.displayReason,
                questions: latest.questions,
              },
        completionUnread: false,
      })
    }
    this.#snapshot = next
    for (const listener of [...this.#listeners]) listener()
  }
}

function kindOfIntent(intent: string | undefined): NoticeKind {
  switch (intent) {
    case "plan-review":
      return "plan-review"
    case "approval":
      return "approval"
    default:
      return "question"
  }
}
