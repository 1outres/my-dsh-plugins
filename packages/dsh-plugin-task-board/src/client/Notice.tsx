import type { NoticeView } from "./page-view"
import type { Translate } from "./types"

export interface NoticeProps {
  readonly notice: NoticeView
  readonly t: Translate
  readonly onRetry: () => void
}

export function Notice({ notice, t, onRetry }: NoticeProps) {
  return (
    <div className="tb-notice" role="alert">
      <div className="tb-notice-messages">
        {notice.messages.map((message) => (
          <p key={message}>{message}</p>
        ))}
      </div>
      {notice.retry === undefined ? null : (
        <button type="button" className="tb-text-button" onClick={onRetry}>
          {t("retry")}
        </button>
      )}
    </div>
  )
}
