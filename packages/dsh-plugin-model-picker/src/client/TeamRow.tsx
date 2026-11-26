import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react"
import { Spinner } from "./icons"
import {
  type ModelSelectionProjection,
  type SaveTeamMode,
  type TeamModeProjection,
  teamToggleAction,
} from "./team"
import type { Translate } from "./types"

export interface TeamRowProps {
  sessionId: string
  /** The Session's `agentTeam` projection. */
  mode: TeamModeProjection
  /** The Session's `modelSelection` projection; undefined until it arrives. */
  modelSelection: ModelSelectionProjection | undefined
  save: SaveTeamMode
  /** Whether the composer or a model selection refuses changes now. */
  locked: boolean
  /** Show a failure in the picker's toast. */
  reportFailure: (message: string) => void
  /** Move focus back into the menu when the confirmation closes and takes it away. */
  restoreFocus: () => void
  onKeyDown?: (event: ReactKeyboardEvent) => void
  t: Translate
}

/**
 * The Agent teamwork switch of the shipped model menu, which this picker
 * replaces. It shows the saved selection without an optimistic update, and
 * asks before turning teamwork off in a Session that has already run.
 */
export function TeamRow(props: TeamRowProps) {
  const {
    sessionId,
    mode,
    modelSelection,
    save,
    locked,
    reportFailure,
    restoreFocus,
    onKeyDown,
    t,
  } = props
  const [pending, setPending] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const shownConfirmation = useRef(false)
  const restore = useRef(restoreFocus)
  restore.current = restoreFocus
  const showConfirmation = confirming && mode.enabled

  useEffect(() => {
    const wasShown = shownConfirmation.current
    shownConfirmation.current = showConfirmation
    if (showConfirmation) {
      cancelRef.current?.focus()
      return
    }
    if (!wasShown) return
    const active = document.activeElement
    if (active === null || active === document.body || active === rowRef.current) {
      restore.current()
    }
  }, [showConfirmation])

  const holdFocus = () => {
    const row = rowRef.current
    if (row?.contains(document.activeElement) === true) row.focus()
  }

  const changeConfirming = (next: boolean) => {
    holdFocus()
    setConfirming(next)
  }

  const submit = (enabled: boolean) => {
    changeConfirming(false)
    setPending(true)
    save(sessionId, enabled)
      .then(
        (failure) => {
          if (failure !== null) reportFailure(t("team.failed", { message: failure }))
        },
        (error: unknown) => {
          reportFailure(
            t("team.failed", { message: error instanceof Error ? error.message : String(error) }),
          )
        },
      )
      .finally(() => {
        setPending(false)
      })
  }

  const press = () => {
    const next = !mode.enabled
    if (teamToggleAction(next, modelSelection) === "confirm") changeConfirming(true)
    else submit(next)
  }

  const disabled = locked || pending || modelSelection === undefined

  if (showConfirmation) {
    return (
      <div
        ref={rowRef}
        tabIndex={-1}
        className="dsh-mp-team dsh-mp-team-confirm"
        role="alertdialog"
        aria-label={t("team.disable.title")}
      >
        <div className="dsh-mp-team-confirm-title">{t("team.disable.title")}</div>
        <p className="dsh-mp-team-confirm-text">{t("team.disable.description")}</p>
        <p className="dsh-mp-team-confirm-text dsh-mp-team-confirm-warning">
          {t("team.disable.warning")}
        </p>
        <div className="dsh-mp-team-actions">
          <button
            ref={cancelRef}
            type="button"
            className="dsh-mp-team-action"
            onKeyDown={onKeyDown}
            onClick={() => {
              changeConfirming(false)
            }}
          >
            {t("team.disable.cancel")}
          </button>
          <button
            type="button"
            className="dsh-mp-team-action dsh-mp-team-action-danger"
            disabled={locked || pending}
            onKeyDown={onKeyDown}
            onClick={() => {
              submit(false)
            }}
          >
            {t("team.disable.confirm")}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div ref={rowRef} tabIndex={-1} className="dsh-mp-team" title={t("team.description")}>
      <span className="dsh-mp-team-label">{t("team.label")}</span>
      {pending && <Spinner size={12} />}
      <button
        type="button"
        role="switch"
        aria-checked={mode.enabled}
        aria-label={t("team.label")}
        tabIndex={-1}
        className={mode.enabled ? "dsh-mp-switch dsh-mp-switch-on" : "dsh-mp-switch"}
        disabled={disabled}
        onKeyDown={onKeyDown}
        onClick={press}
      >
        <span className="dsh-mp-switch-knob" aria-hidden="true" />
      </button>
    </div>
  )
}
