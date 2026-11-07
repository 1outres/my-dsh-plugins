import { type FormEvent, useCallback, useState, useSyncExternalStore } from "react"
import type {
  RemoteHostKey,
  RemotePromptAnswer,
  RemotePromptRequest,
  RemoteTarget,
} from "../shared/types"
import type { ContentBlock, PromptBridge, ToolCallBlock, ToolCallProps, Translate } from "./types"

export interface RemoteToolViewProps extends ToolCallProps {
  bridge: PromptBridge
  t: Translate
}

const TOOL_NAMES = [
  "remote_target_add",
  "remote_target_list",
  "remote_target_remove",
  "remote_exec",
  "remote_read",
  "remote_write",
  "remote_edit",
  "remote_session_open",
  "remote_session_send",
  "remote_session_read",
  "remote_session_close",
] as const

export const REMOTE_TOOL_NAMES: readonly string[] = TOOL_NAMES

/** One card for every remote_* tool call. */
export function RemoteToolView(props: RemoteToolViewProps): React.JSX.Element {
  const block = props.block as Partial<ToolCallBlock>
  const prompt = usePrompt(props.bridge, props.callId)
  if (prompt !== undefined) {
    return <PromptCard key={prompt.id} prompt={prompt} bridge={props.bridge} t={props.t} />
  }
  return (
    <ResultRow
      block={block}
      phase={props.phase}
      toolName={props.toolName}
      t={props.t}
      callId={props.callId}
    />
  )
}

function usePrompt(bridge: PromptBridge, callId: string): RemotePromptRequest | undefined {
  const subscribe = useCallback((listener: () => void) => bridge.subscribe(listener), [bridge])
  const snapshot = useCallback(() => bridge.get(callId), [bridge, callId])
  return useSyncExternalStore(subscribe, snapshot)
}

interface PromptCardProps {
  prompt: RemotePromptRequest
  bridge: PromptBridge
  t: Translate
}

function PromptCard({ prompt, bridge, t }: PromptCardProps): React.JSX.Element {
  const [values, setValues] = useState<Record<string, string>>({})
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const answer = async (payload: RemotePromptAnswer): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(undefined)
    try {
      await bridge.answer(prompt, payload)
    } catch (caught) {
      setBusy(false)
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  const submitValues = (event: FormEvent): void => {
    event.preventDefault()
    if (prompt.kind === "hostkey") {
      void answer({ decision: "approve" })
      return
    }
    if (prompt.kind === "secret") {
      void answer({ decision: "submit", values })
      return
    }
    void answer({ decision: "approve", values })
  }

  const reject = (): void => {
    void answer({
      decision: "reject",
      ...(reason.trim().length === 0 ? {} : { reason: reason.trim() }),
    })
  }

  const title =
    prompt.kind === "register"
      ? t("card.register.title")
      : prompt.kind === "hostkey"
        ? t("card.hostkey.title")
        : t("card.secret.title")

  return (
    <form className="remote-card remote-card-waiting" onSubmit={submitValues}>
      <div className="remote-head">
        <span>{title}</span>
        <span className="remote-badge">{t("state.waiting")}</span>
      </div>
      {prompt.retry === true ? (
        <div className="remote-warning">{t("card.secret.retry")}</div>
      ) : null}
      {prompt.detail !== undefined && prompt.kind !== "register" ? (
        <div className="remote-summary">{prompt.detail}</div>
      ) : null}
      {prompt.kind === "register" && prompt.target !== undefined ? (
        <>
          <div className="remote-summary">{t("card.register.detail")}</div>
          <TargetSummary target={prompt.target} t={t} />
        </>
      ) : null}
      {prompt.kind === "hostkey" ? <HostKeySummary hostKey={prompt.hostKey} t={t} /> : null}
      {prompt.fields.map((field) => (
        <div className="remote-field" key={field.name}>
          <label htmlFor={`remote-${prompt.id}-${field.name}`}>
            {fieldLabel(t, field.name, field.label)}
          </label>
          <input
            id={`remote-${prompt.id}-${field.name}`}
            className="remote-input"
            type={field.masked ? "password" : "text"}
            autoComplete="off"
            disabled={busy}
            required
            value={values[field.name] ?? ""}
            onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
          />
        </div>
      ))}
      {prompt.kind === "register" ? (
        <div className="remote-field">
          <label htmlFor={`remote-${prompt.id}-reason`}>{t("card.reason")}</label>
          <textarea
            id={`remote-${prompt.id}-reason`}
            className="remote-textarea"
            disabled={busy}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      ) : null}
      {error !== undefined ? <div className="remote-error">{error}</div> : null}
      <div className="remote-actions">
        {prompt.kind === "register" ? (
          <button
            className="remote-button remote-button-danger"
            type="button"
            disabled={busy}
            onClick={reject}
          >
            {t("card.register.reject")}
          </button>
        ) : null}
        {prompt.kind === "hostkey" ? (
          <button
            className="remote-button remote-button-danger"
            type="button"
            disabled={busy}
            onClick={reject}
          >
            {t("card.hostkey.reject")}
          </button>
        ) : null}
        <button className="remote-button remote-button-primary" type="submit" disabled={busy}>
          {prompt.kind === "register"
            ? t("card.register.approve")
            : prompt.kind === "hostkey"
              ? t("card.hostkey.accept")
              : t("card.secret.submit")}
        </button>
      </div>
    </form>
  )
}

function TargetSummary({ target, t }: { target: RemoteTarget; t: Translate }): React.JSX.Element {
  return (
    <dl className="remote-grid">
      <dt>{t("label.host")}</dt>
      <dd>{target.host}</dd>
      {target.user === undefined ? null : (
        <>
          <dt>{t("label.user")}</dt>
          <dd>{target.user}</dd>
        </>
      )}
      {target.port === undefined ? null : (
        <>
          <dt>{t("label.port")}</dt>
          <dd>{target.port}</dd>
        </>
      )}
      <dt>{t("label.kind")}</dt>
      <dd>{target.kind === "linux" ? t("kind.linux") : t("kind.network")}</dd>
      <dt>{t("label.jump")}</dt>
      <dd>{target.jump ?? t("label.none")}</dd>
      {target.sshOptions.length === 0 ? null : (
        <>
          <dt>{t("label.options")}</dt>
          <dd>{target.sshOptions.join(" ")}</dd>
        </>
      )}
      {target.initCommands.length === 0 ? null : (
        <>
          <dt>{t("label.initCommands")}</dt>
          <dd>{target.initCommands.join(" ; ")}</dd>
        </>
      )}
    </dl>
  )
}

function HostKeySummary({
  hostKey,
  t,
}: {
  hostKey: RemoteHostKey | undefined
  t: Translate
}): React.JSX.Element {
  return (
    <>
      <div className="remote-summary">{t("card.hostkey.detail")}</div>
      <dl className="remote-grid">
        <dt>{t("label.hostKeyHost")}</dt>
        <dd>{hostKey?.host ?? ""}</dd>
        <dt>{t("label.algorithm")}</dt>
        <dd>{hostKey?.algorithm ?? ""}</dd>
        <dt>{t("label.fingerprint")}</dt>
        <dd className="remote-fingerprint">{hostKey?.fingerprint ?? ""}</dd>
      </dl>
    </>
  )
}

interface ResultRowProps {
  block: Partial<ToolCallBlock>
  phase: ToolCallProps["phase"]
  toolName: string
  callId: string
  t: Translate
}

function ResultRow({ block, phase, toolName, t }: ResultRowProps): React.JSX.Element {
  const title = translateOr(t, `title.${toolName}`, toolName)
  const summary = summaryOf(block)
  const text = contentText(block)
  const isError = block.isError === true
  const status =
    phase === "result"
      ? isError
        ? t("state.error")
        : undefined
      : phase === "start"
        ? t("state.running")
        : t("state.preparing")
  return (
    <div className={`remote-card${isError ? " remote-card-waiting" : ""}`}>
      <div className="remote-head">
        <span>{title}</span>
        {status === undefined ? null : <span className="remote-badge">{status}</span>}
      </div>
      {summary.length === 0 ? null : <div className="remote-summary">{summary}</div>}
      {text.length === 0 ? null : text.length <= 1200 && !isError ? (
        <pre className="remote-pre">{text}</pre>
      ) : (
        <details className="remote-details" open={isError}>
          <summary>{isError ? t("state.error") : "Output"}</summary>
          <pre className="remote-pre">{text}</pre>
        </details>
      )}
    </div>
  )
}

function summaryOf(block: Partial<ToolCallBlock>): string {
  const args = block.args
  if (args === undefined) return ""
  const target = args.text("target")
  const command = args.text("command")
  const path = args.text("path")
  const session = args.text("sessionId")
  const parts: string[] = []
  if (target !== undefined) parts.push(target)
  if (session !== undefined) parts.push(session)
  if (path !== undefined) parts.push(path)
  if (command !== undefined) parts.push(command)
  return parts.join(" · ")
}

function contentText(block: Partial<ToolCallBlock>): string {
  const content: readonly ContentBlock[] = block.content ?? []
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n")
}

function fieldLabel(t: Translate, name: string, fallback: string): string {
  const translated = t(`field.${name}`)
  return translated === `field.${name}` ? fallback : translated
}

function translateOr(t: Translate, key: string, fallback: string): string {
  const translated = t(key)
  return translated === key ? fallback : translated
}
