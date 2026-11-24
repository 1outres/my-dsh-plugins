import { useState } from "react"
import type { SessionId } from "../shared/model"
import { TaskBoardIcon } from "./TaskBoardIcon"
import type { Translate } from "./types"

export interface SessionBoardButtonInjected {
  readonly sessionId: SessionId
  readonly open: (sessionId: SessionId) => Promise<void>
  readonly t: Translate
}

export function SessionBoardButton({ sessionId, open, t }: SessionBoardButtonInjected) {
  const [error, setError] = useState<string | undefined>(undefined)
  const label = error ?? t("sessionButton")
  const openBoard = (): void => {
    setError(undefined)
    void open(sessionId).catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(t("sessionButtonFailed", { message }))
    })
  }
  return (
    <button
      type="button"
      className="tb-header-button"
      data-failed={error === undefined ? undefined : "true"}
      title={label}
      aria-label={label}
      onClick={openBoard}
    >
      <TaskBoardIcon size={16} />
    </button>
  )
}
