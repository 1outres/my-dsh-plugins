import { useCallback, useEffect, useRef, useSyncExternalStore } from "react"
import { COLLAPSED_ATTRIBUTE, useFrameFlag } from "./frame"
import { IconMenu } from "./icons"
import type {
  ModeState,
  Observable,
  SessionsState,
  Translate,
  UsePanelInfo,
  UseSessions,
} from "./types"

function useObservable<T>(observable: Observable<T>): T {
  const subscribe = useCallback(
    (listener: () => void) => observable.subscribe(listener),
    [observable],
  )
  const getSnapshot = useCallback(() => observable.getSnapshot(), [observable])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Shared by both entries through the slot `inject` face. */
export interface DrawerFace {
  mode: Observable<ModeState>
  /** Open or close the sidebar drawer (`ctx.layout.toggleSidebar`). */
  toggle(): void
}

/** The Session the main column shows, if any. */
export function mainSessionOf(state: SessionsState): string | undefined {
  for (const [id, row] of Object.entries(state.byId)) {
    if ((row?.retainedBy?.mainView ?? 0) > 0) return id
  }
  return undefined
}

export interface HeaderMenuButtonProps extends DrawerFace {
  t: Translate
}

/**
 * The drawer's menu button before the Session title. It always renders so it
 * can find its frame, and is hidden outside the phone layout.
 */
export function HeaderMenuButton({ mode, toggle, t }: HeaderMenuButtonProps) {
  const state = useObservable(mode)
  const ref = useRef<HTMLButtonElement>(null)
  const collapsed = useFrameFlag(ref, COLLAPSED_ATTRIBUTE)
  const expanded = collapsed === false
  return (
    <button
      ref={ref}
      type="button"
      className="dsh-mobile-menu"
      hidden={!state.mobile}
      aria-label={expanded ? t("menu.close") : t("menu.open")}
      aria-expanded={state.mobile ? expanded : undefined}
      onClick={toggle}
    >
      <IconMenu size={18} />
    </button>
  )
}

export interface DrawerOverlayProps extends DrawerFace {
  t: Translate
  usePanelInfo: UsePanelInfo
  useSessions: UseSessions
}

/**
 * Frame-wide parts of the drawer: the scrim that closes it, a floating menu
 * button while a global panel (which has no Conversation header) is shown, and
 * closing the drawer once a Session or panel is picked from it.
 */
export function DrawerOverlay({ mode, toggle, t, usePanelInfo, useSessions }: DrawerOverlayProps) {
  const state = useObservable(mode)
  const anchor = useRef<HTMLSpanElement>(null)
  const collapsed = useFrameFlag(anchor, COLLAPSED_ATTRIBUTE)
  const expanded = state.mobile && collapsed === false
  const panel = usePanelInfo((info) => info.activePanelId)
  const session = useSessions(mainSessionOf)

  const seen = useRef({ panel, session })
  useEffect(() => {
    const before = seen.current
    seen.current = { panel, session }
    if (before.panel === panel && before.session === session) return
    if (expanded) toggle()
  }, [panel, session, expanded, toggle])

  return (
    <>
      <span ref={anchor} hidden />
      {state.mobile ? (
        <div
          className="dsh-mobile-scrim"
          data-open={expanded ? "" : undefined}
          aria-hidden="true"
          onClick={toggle}
        />
      ) : null}
      {state.mobile && panel !== null && !expanded ? (
        <button
          type="button"
          className="dsh-mobile-menu dsh-mobile-floating"
          aria-label={t("menu.open")}
          onClick={toggle}
        >
          <IconMenu size={18} />
        </button>
      ) : null}
    </>
  )
}
