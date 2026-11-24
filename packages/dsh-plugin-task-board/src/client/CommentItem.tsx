import { IconButton } from "./IconButton"
import { TrashIcon } from "./icons"
import type { Translate } from "./types"
import type { CommentView } from "./view"

export interface CommentItemProps {
  readonly comment: CommentView
  readonly createdAt: number
  readonly t: Translate
  readonly busy: boolean
  readonly onDelete: () => void
}

export function CommentItem({ comment, createdAt, t, busy, onDelete }: CommentItemProps) {
  return (
    <li className="tb-comment">
      <div className="tb-comment-head">
        <span className="tb-comment-author">{comment.author}</span>
        {comment.agentId === undefined ? null : (
          <span className="tb-comment-agent">{comment.agentId}</span>
        )}
        <time
          className="tb-comment-time"
          dateTime={new Date(createdAt).toISOString()}
          title={comment.full}
        >
          {comment.relative}
        </time>
        {comment.deletable ? (
          <IconButton
            className="tb-quiet tb-comment-delete"
            label={t("deleteComment")}
            disabled={busy}
            onClick={onDelete}
          >
            <TrashIcon size={14} />
          </IconButton>
        ) : null}
      </div>
      <p className="tb-comment-body">{comment.body}</p>
    </li>
  )
}
