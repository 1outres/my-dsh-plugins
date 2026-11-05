import {
  type ComponentType,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { type MessageParts, messageParts } from "./content"
import type { EditFailure, EditOutcome, EditRequest } from "./edit"
import { IconEdit } from "./icons"
import type { ContentBlock, StoredSlotEntry, Translate } from "./types"

/** The props of a `conversation.chat.node` entry this view reads; the rest pass through. */
export interface UserNodeProps {
  node: {
    kind: string
    data?: { content?: readonly ContentBlock[] }
    location?: {
      kind: string
      turn?: { turn?: number; start?: { seq?: number } }
      step?: { step?: number }
    }
  }
  sessionId: string
  useSession: <T>(selector: (snapshot: { running: boolean; subagent: unknown }) => T) => T
  useAccess: (action: string) => boolean
  [prop: string]: unknown
}

/** What editing one message needs, derived from its Chat node. */
export interface EditableMessage {
  turn: number
  turnStartSeq: number
  content: readonly ContentBlock[]
  parts: MessageParts
}

/**
 * Accept only the human prompt that opens a turn: the first step of a turn
 * whose `turn/start` is known.
 * @param node - the Chat node.
 * @returns the editable message, or undefined.
 */
export function editableMessage(node: UserNodeProps["node"]): EditableMessage | undefined {
  if (node.kind !== "user") return undefined
  const location = node.location
  if (location?.kind !== "step" || location.step?.step !== 1) return undefined
  const turn = location.turn?.turn
  const turnStartSeq = location.turn?.start?.seq
  if (typeof turn !== "number" || turn < 1 || typeof turnStartSeq !== "number") return undefined
  const content = node.data?.content
  if (!Array.isArray(content)) return undefined
  return { turn, turnStartSeq, content, parts: messageParts(content) }
}

/**
 * The renderer this plugin wraps: the next `user` entry below its own priority.
 * @param entries - the slot's stored entries, lowest priority first.
 * @param self - this plugin's component.
 * @param priority - this plugin's priority.
 * @returns the wrapped component, or undefined.
 */
export function wrappedRenderer(
  entries: readonly StoredSlotEntry[],
  // biome-ignore lint/suspicious/noExplicitAny: compared by identity only
  self: ComponentType<any>,
  priority: number,
  // biome-ignore lint/suspicious/noExplicitAny: the slot runtime supplies the props
): ComponentType<any> | undefined {
  for (const entry of entries) {
    if (entry.options.key !== "user" || entry.component === self) continue
    if ((entry.options.priority ?? 0) <= priority) continue
    return entry.component
  }
  return undefined
}

/**
 * The shipped message action row: the copy button's row carries `data-clock`.
 * @param root - the wrapped bubble.
 * @returns the last action row inside it, or null.
 */
export function findActionRow(root: ParentNode): HTMLElement | null {
  const rows = root.querySelectorAll<HTMLElement>("[data-clock]")
  return rows.length > 0 ? (rows[rows.length - 1] ?? null) : null
}

type Unavailable = "running" | "files" | "noAccess"

function EditButton({
  t,
  unavailable,
  onEdit,
}: {
  t: Translate
  unavailable: Unavailable | undefined
  onEdit: () => void
}) {
  const [tip, setTip] = useState(false)
  const reasonId = useId()
  const label = t("edit")
  const reason = unavailable === undefined ? undefined : t(`edit.${unavailable}`)
  return (
    <>
      <button
        type="button"
        className="dsh-em-action"
        aria-label={label}
        aria-disabled={unavailable === undefined ? undefined : true}
        aria-describedby={reason === undefined ? undefined : reasonId}
        data-unavailable={unavailable === undefined ? undefined : ""}
        onClick={unavailable === undefined ? onEdit : undefined}
        onMouseEnter={() => setTip(true)}
        onMouseLeave={() => setTip(false)}
        onFocus={() => setTip(true)}
        onBlur={() => setTip(false)}
      >
        <IconEdit />
      </button>
      {reason === undefined ? null : (
        <span id={reasonId} className="dsh-em-hidden">
          {reason}
        </span>
      )}
      {tip ? (
        <span className="dsh-em-tip" role="tooltip">
          {reason ?? label}
        </span>
      ) : null}
    </>
  )
}

function failureText(t: Translate, reason: EditFailure, detail: string | undefined): string {
  return t(`error.${reason}`, { detail: detail ?? "" })
}

function MessageEditor({
  t,
  message,
  onCancel,
  onSend,
}: {
  t: Translate
  message: EditableMessage
  onCancel: () => void
  onSend: (text: string) => Promise<EditOutcome>
}) {
  const [text, setText] = useState(message.parts.text)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const mounted = useRef(true)

  useEffect(
    () => () => {
      mounted.current = false
    },
    [],
  )

  const resize = useCallback(() => {
    const element = input.current
    if (element === null) return
    element.style.height = "auto"
    element.style.height = `${element.scrollHeight}px`
  }, [])

  useLayoutEffect(() => {
    const element = input.current
    if (element === null) return
    resize()
    element.focus()
    element.setSelectionRange(element.value.length, element.value.length)
  }, [resize])

  const empty = text.trim().length === 0

  const send = async () => {
    if (busy || empty) return
    setBusy(true)
    setError(null)
    const outcome = await onSend(text)
    if (!mounted.current) return
    setBusy(false)
    if (!outcome.ok) setError(failureText(t, outcome.reason, outcome.detail))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      if (!busy) onCancel()
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      event.stopPropagation()
      void send()
    }
  }

  const images = message.parts.images.length
  return (
    <div className="dsh-em-editor" data-plugin="@1outres/dsh-plugin-edit-message">
      <div className="dsh-em-box">
        <textarea
          ref={input}
          className="dsh-em-input"
          aria-label={t("editor.aria")}
          value={text}
          rows={1}
          disabled={busy}
          onChange={(event) => {
            setText(event.target.value)
            resize()
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="dsh-em-footer">
        <div className="dsh-em-notes">
          {error === null ? null : (
            <span className="dsh-em-error" role="alert">
              {error}
            </span>
          )}
          {images > 0 ? <span>{t("editor.images", { count: images })}</span> : null}
        </div>
        <div className="dsh-em-buttons">
          <button
            type="button"
            className="dsh-em-button dsh-em-cancel"
            disabled={busy}
            onClick={onCancel}
          >
            {t("editor.cancel")}
          </button>
          <button
            type="button"
            className="dsh-em-button dsh-em-send"
            disabled={busy || empty}
            onClick={() => void send()}
          >
            {busy ? t("editor.sending") : t("editor.send")}
          </button>
        </div>
      </div>
    </div>
  )
}

export interface ViewDeps {
  /** Stored entries of `conversation.chat.node`. */
  entries: () => readonly StoredSlotEntry[]
  priority: number
  t: Translate
  edit: (request: EditRequest) => Promise<EditOutcome>
}

/**
 * Build the `user` Chat node renderer. It renders the wrapped renderer
 * unchanged and adds an Edit button to that bubble's action row, after Copy.
 * While editing, the bubble is replaced by an inline editor.
 * @param deps - slot entries, priority, translation, and the edit operation.
 * @returns the slot component.
 */
export function createEditableUserMessage(deps: ViewDeps): ComponentType<UserNodeProps> {
  // biome-ignore lint/correctness/noComponentHookFactories: built once per plugin activation, never during a render
  function EditableUserMessage(props: UserNodeProps) {
    const Wrapped = wrappedRenderer(deps.entries(), EditableUserMessage, deps.priority)
    // An entry that throws is retired by the slot runtime, which then renders the shipped one.
    if (Wrapped === undefined) throw new Error("edit-message: no user message renderer to wrap")

    const { node, sessionId, useSession, useAccess } = props
    const running = useSession((snapshot) => snapshot.running)
    const subagent = useSession(
      (snapshot) => snapshot.subagent !== null && snapshot.subagent !== undefined,
    )
    const forkAllowed = useAccess("session/fork")
    const [editing, setEditing] = useState(false)
    const [seat, setSeat] = useState<HTMLElement | null>(null)
    const wrap = useRef<HTMLDivElement>(null)
    const message = subagent ? undefined : editableMessage(node)
    const visible = message !== undefined

    useLayoutEffect(() => {
      const root = wrap.current
      if (editing || !visible || root === null) return
      const span = document.createElement("span")
      span.className = "dsh-em-seat"
      const attach = () => {
        const row = findActionRow(root)
        if (row === null) span.remove()
        else if (span.parentElement !== row) row.append(span)
      }
      attach()
      setSeat(span)
      const observer =
        typeof MutationObserver === "undefined" ? undefined : new MutationObserver(attach)
      observer?.observe(root, { childList: true, subtree: true })
      return () => {
        observer?.disconnect()
        span.remove()
        setSeat(null)
      }
    }, [editing, visible])

    if (editing && message !== undefined) {
      return (
        <MessageEditor
          t={deps.t}
          message={message}
          onCancel={() => setEditing(false)}
          onSend={async (text) => {
            const outcome = await deps.edit({
              sessionId,
              turn: message.turn,
              turnStartSeq: message.turnStartSeq,
              content: message.content,
              text,
            })
            if (outcome.ok) setEditing(false)
            return outcome
          }}
        />
      )
    }

    const unavailable: Unavailable | undefined = !forkAllowed
      ? "noAccess"
      : running
        ? "running"
        : message?.parts.hasFiles
          ? "files"
          : undefined

    return (
      <div ref={wrap} style={{ display: "contents" }}>
        <Wrapped {...props} />
        {seat !== null && message !== undefined
          ? createPortal(
              <EditButton t={deps.t} unavailable={unavailable} onEdit={() => setEditing(true)} />,
              seat,
            )
          : null}
      </div>
    )
  }
  return EditableUserMessage
}
