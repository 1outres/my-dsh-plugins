import { useCallback, useSyncExternalStore } from "react"
import { IconScratch } from "./icons"
import type { ScratchStatus } from "./scratch"
import type { Observable, SessionListState, Translate } from "./types"

function useObservable<T>(observable: Observable<T>): T {
  const subscribe = useCallback(
    (listener: () => void) => observable.subscribe(listener),
    [observable],
  )
  const getSnapshot = useCallback(() => observable.getSnapshot(), [observable])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Shared by both buttons through the slot `inject` face. */
export interface StarterFace {
  start(): Promise<void>
  status: Observable<ScratchStatus>
}

export interface FooterButtonProps extends StarterFace {
  /** False while the sidebar is the 56px rail. */
  wide: boolean
  t: Translate
}

/** "New scratch" at the sidebar foot, beside Settings. */
export function NewScratchFooterButton({ wide, t, start, status }: FooterButtonProps) {
  const { busy, error } = useObservable(status)
  const label = busy ? t("action.busy") : (error ?? t("action.label"))
  return (
    <button
      type="button"
      className="dsh-scratch-footer"
      data-rail={wide ? undefined : ""}
      disabled={busy}
      title={error ?? t("action.hint")}
      aria-label={t("action.label")}
      onClick={() => {
        void start()
      }}
    >
      <IconScratch size={16} />
      {wide ? (
        <span className="dsh-scratch-label" data-error={error === undefined ? undefined : ""}>
          {label}
        </span>
      ) : null}
    </button>
  )
}

export interface HeroChipProps extends StarterFace {
  t: Translate
  sessionId: string
  sessions: Observable<SessionListState>
  /** Whether a cwd is the scratch root itself. */
  isRoot(cwd: string | undefined): boolean
}

/**
 * Shown in the New Session row of a blank Session created in the root
 * Workspace, whose Session could write to every scratch.
 */
export function NewScratchChip({ t, start, status, sessionId, sessions, isRoot }: HeroChipProps) {
  const list = useObservable(sessions)
  const { busy, error } = useObservable(status)
  if (!isRoot(list.byId[sessionId]?.cwd)) return null
  return (
    <button
      type="button"
      className="dsh-scratch-chip"
      disabled={busy}
      title={error ?? t("chip.hint")}
      onClick={() => {
        void start()
      }}
    >
      <IconScratch size={14} />
      <span>{busy ? t("action.busy") : t("chip.label")}</span>
    </button>
  )
}
