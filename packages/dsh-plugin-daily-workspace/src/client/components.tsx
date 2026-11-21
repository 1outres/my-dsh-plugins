import { useCallback, useSyncExternalStore } from "react"
import { IconToday } from "./icons"
import { QUICK_START_ATTR } from "./quick-start"
import type { TodayStatus } from "./today"
import type { Observable, Translate } from "./types"

function useObservable<T>(observable: Observable<T>): T {
  const subscribe = useCallback(
    (listener: () => void) => observable.subscribe(listener),
    [observable],
  )
  const getSnapshot = useCallback(() => observable.getSnapshot(), [observable])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Marks the button for the shared quick start row. */
const QUICK_START_PROPS = { [QUICK_START_ATTR]: "" }

/** Shared with the slot `inject` face. */
export interface OpenTodayFace {
  open(): Promise<void>
  status: Observable<TodayStatus>
}

export interface FooterButtonProps extends OpenTodayFace {
  /** False while the sidebar is the 56px rail. */
  wide: boolean
  t: Translate
}

/** "Open today" at the sidebar foot, beside Settings. */
export function OpenTodayFooterButton({ wide, t, open, status }: FooterButtonProps) {
  const { busy, error } = useObservable(status)
  return (
    <button
      type="button"
      className="dsh-today-footer"
      {...QUICK_START_PROPS}
      data-rail={wide ? undefined : ""}
      disabled={busy}
      title={error ?? t("action.hint")}
      aria-label={t("action.label")}
      onClick={() => {
        void open()
      }}
    >
      <IconToday size={16} />
      {wide ? (
        <span className="dsh-today-label" data-error={error === undefined ? undefined : ""}>
          {busy ? (
            t("action.busy")
          ) : error !== undefined ? (
            error
          ) : (
            <>
              <span className="dsh-today-label-full">{t("action.label")}</span>
              <span className="dsh-today-label-short">{t("action.short")}</span>
            </>
          )}
        </span>
      ) : null}
    </button>
  )
}
