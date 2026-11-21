import { useCallback, useSyncExternalStore } from "react"
import { IconScratch } from "./icons"
import { QUICK_START_ATTR } from "./quick-start"
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

/** Marks the footer button for the shared quick start row. */
const QUICK_START_PROPS = { [QUICK_START_ATTR]: "" }

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
  return (
    <button
      type="button"
      className="dsh-scratch-footer"
      {...QUICK_START_PROPS}
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
          {busy ? (
            t("action.busy")
          ) : error !== undefined ? (
            error
          ) : (
            <>
              <span className="dsh-scratch-label-full">{t("action.label")}</span>
              <span className="dsh-scratch-label-short">{t("action.short")}</span>
            </>
          )}
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
