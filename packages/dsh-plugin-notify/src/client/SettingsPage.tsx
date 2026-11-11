import type { CSSProperties } from "react"
import { useCallback, useState, useSyncExternalStore } from "react"
import { normalizeConfig } from "./config"
import type { PushController, PushState } from "./push"
import type { ConfigForm, NotifyConfig, Translate } from "./types"

/** Notification capability the browser half exposes to this page. */
export interface Notifier {
  /** Current browser permission; `unsupported` when the API is missing. */
  permission(): "granted" | "denied" | "default" | "unsupported"
  /** Ask the browser for permission; resolves to the resulting state. */
  request(): Promise<string>
  /** Send a test notification; resolves to whether one was shown. */
  test(): Promise<boolean>
}

export interface SettingsPageProps {
  form: ConfigForm<NotifyConfig>
  t: Translate
  notifier: Notifier
  push: PushController
}

type Field = Exclude<keyof NotifyConfig, never>

const PERMISSION_KEYS: Record<string, string> = {
  granted: "permissionGranted",
  denied: "permissionDenied",
  default: "permissionDefault",
  unsupported: "permissionUnsupported",
}

const PUSH_STATE_KEYS: Record<PushState, string> = {
  unsupported: "pushUnsupported",
  "no-worker": "pushNoWorker",
  "needs-install": "pushNeedsInstall",
  off: "pushOff",
  on: "pushOn",
  denied: "pushDenied",
  error: "pushError",
}

const sectionStyle: CSSProperties = {
  maxWidth: 680,
  padding: "4px 0 32px",
  color: "var(--dsw-alias-label-primary)",
}

const headingStyle: CSSProperties = {
  margin: 0,
  fontSize: 18,
  fontWeight: 600,
  lineHeight: 1.4,
}

const introStyle: CSSProperties = {
  margin: "8px 0 0",
  color: "var(--dsw-alias-label-secondary)",
  fontSize: 13,
  lineHeight: 1.6,
}

const toggleStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  marginTop: 20,
  fontSize: 13,
  fontWeight: 600,
}

const hintStyle: CSSProperties = {
  margin: 0,
  color: "var(--dsw-alias-label-tertiary)",
  fontSize: 12,
  lineHeight: 1.5,
  fontWeight: 400,
}

const errorStyle: CSSProperties = {
  margin: "8px 0 0",
  color: "var(--dsw-alias-state-error-primary)",
  fontSize: 12,
  lineHeight: 1.5,
}

const groupStyle: CSSProperties = {
  margin: "26px 0 0",
  paddingTop: 18,
  borderTop: "1px solid var(--dsw-alias-border-l2)",
}

const buttonStyle: CSSProperties = {
  marginTop: 12,
  marginRight: 8,
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid var(--dsw-alias-border-l2)",
  background: "var(--dsw-alias-bg-layer-1)",
  color: "inherit",
  font: "inherit",
  cursor: "pointer",
}

const mutedStyle: CSSProperties = {
  color: "var(--dsw-alias-label-tertiary)",
  fontSize: 13,
  lineHeight: 1.6,
}

/** Settings page: the switches, the browser permission, and per-device push. */
export function SettingsPage({ form, t, notifier, push }: SettingsPageProps) {
  const subscribe = useCallback((listener: () => void) => form.subscribe(listener), [form])
  const getSnapshot = useCallback(() => form.getSnapshot(), [form])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const config = normalizeConfig(snapshot.value)

  const subscribePush = useCallback(
    (listener: () => void) => push.state.subscribe(listener),
    [push],
  )
  const getPush = useCallback(() => push.state.getSnapshot(), [push])
  const pushState = useSyncExternalStore(subscribePush, getPush, getPush)

  const [permission, setPermission] = useState(() => notifier.permission())
  const [busy, setBusy] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [message, setMessage] = useState<string | undefined>(undefined)
  const [pushMessage, setPushMessage] = useState<string | undefined>(undefined)
  const [writeError, setWriteError] = useState(false)

  const write = (field: Field, value: boolean) => {
    void form
      .set(field, value)
      .then((accepted) => setWriteError(!accepted))
      .catch(() => setWriteError(true))
  }

  const allow = async () => {
    setBusy(true)
    setMessage(undefined)
    try {
      setPermission((await notifier.request()) as typeof permission)
    } finally {
      setBusy(false)
    }
  }

  const test = async () => {
    setBusy(true)
    setMessage(undefined)
    try {
      const shown = await notifier.test()
      setPermission(notifier.permission())
      setMessage(shown ? t("testSent") : t("testBlocked"))
    } finally {
      setBusy(false)
    }
  }

  const enablePush = async () => {
    setPushBusy(true)
    setPushMessage(undefined)
    try {
      await push.enable()
    } finally {
      setPushBusy(false)
    }
  }

  const disablePush = async () => {
    setPushBusy(true)
    setPushMessage(undefined)
    try {
      await push.disable()
    } finally {
      setPushBusy(false)
    }
  }

  const testPush = async () => {
    setPushBusy(true)
    setPushMessage(undefined)
    try {
      const result = await push.test()
      setPushMessage(
        result === "sent"
          ? t("pushTestSent")
          : result === "gone"
            ? t("pushTestGone")
            : t("pushTestFailed"),
      )
    } finally {
      setPushBusy(false)
    }
  }

  if (snapshot.status === "unavailable") {
    return <p style={mutedStyle}>{t("unavailable")}</p>
  }

  const disabled = snapshot.writable === false || busy || pushBusy
  const installNeeded = pushState === "needs-install"
  const unsupported = permission === "unsupported"
  const permissionLabel = installNeeded
    ? t("permissionNeedsInstall")
    : t(PERMISSION_KEYS[permission] ?? "permissionDefault")
  const pushLabel = t(PUSH_STATE_KEYS[pushState])

  return (
    <div style={sectionStyle}>
      <h2 style={headingStyle}>{t("title")}</h2>
      <p style={introStyle}>{t("description")}</p>

      <Toggle
        label={t("enabled")}
        hint={t("enabledHint")}
        checked={config.enabled}
        disabled={disabled}
        onChange={(next) => write("enabled", next)}
      />
      <Toggle
        label={t("onlyWhenUnfocused")}
        hint={t("onlyWhenUnfocusedHint")}
        checked={config.onlyWhenUnfocused}
        disabled={disabled}
        onChange={(next) => write("onlyWhenUnfocused", next)}
      />
      <Toggle
        label={t("push")}
        hint={t("pushHint")}
        checked={config.push}
        disabled={disabled}
        onChange={(next) => write("push", next)}
      />

      <div style={groupStyle}>
        <Toggle
          label={t("approval")}
          hint={t("approvalHint")}
          checked={config.approval}
          disabled={disabled}
          onChange={(next) => write("approval", next)}
        />
        <Toggle
          label={t("question")}
          hint={t("questionHint")}
          checked={config.question}
          disabled={disabled}
          onChange={(next) => write("question", next)}
        />
        <Toggle
          label={t("completion")}
          hint={t("completionHint")}
          checked={config.completion}
          disabled={disabled}
          onChange={(next) => write("completion", next)}
        />
        <Toggle
          label={t("showDetail")}
          hint={t("showDetailHint")}
          checked={config.showDetail}
          disabled={disabled}
          onChange={(next) => write("showDetail", next)}
        />
      </div>

      <div style={groupStyle}>
        <div style={toggleStyle}>
          <span>{t("pushDevice")}</span>
          <span style={{ fontWeight: 400, color: "var(--dsw-alias-label-secondary)" }}>
            {pushLabel}
          </span>
        </div>
        <p style={hintStyle}>{t("pushRequirement")}</p>
        <button
          type="button"
          style={buttonStyle}
          disabled={disabled || pushState === "unsupported"}
          onClick={() => void (pushState === "on" ? disablePush() : enablePush())}
        >
          {pushState === "on" ? t("pushTurnOff") : t("pushTurnOn")}
        </button>
        <button
          type="button"
          style={buttonStyle}
          disabled={disabled || pushState !== "on"}
          onClick={() => void testPush()}
        >
          {t("pushTest")}
        </button>
        {pushMessage === undefined ? null : <p style={hintStyle}>{pushMessage}</p>}
      </div>

      <div style={groupStyle}>
        <div style={toggleStyle}>
          <span>{t("permission")}</span>
          <span style={{ fontWeight: 400, color: "var(--dsw-alias-label-secondary)" }}>
            {permissionLabel}
          </span>
        </div>
        {permission === "default" ? (
          <button
            type="button"
            style={buttonStyle}
            disabled={disabled || installNeeded}
            onClick={() => void allow()}
          >
            {t("allow")}
          </button>
        ) : null}
        <button
          type="button"
          style={buttonStyle}
          disabled={disabled || unsupported || installNeeded}
          onClick={() => void test()}
        >
          {t("test")}
        </button>
        {message === undefined ? null : <p style={hintStyle}>{message}</p>}
        {writeError ? <p style={errorStyle}>{t("writeError")}</p> : null}
      </div>
    </div>
  )
}

interface ToggleProps {
  label: string
  hint: string
  checked: boolean
  disabled: boolean
  onChange: (next: boolean) => void
}

function Toggle({ label, hint, checked, disabled, onChange }: ToggleProps) {
  return (
    <div style={toggleStyle}>
      <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span>{label}</span>
        <span style={hintStyle}>{hint}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className="dsh-notify-switch"
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation()
          onChange(!checked)
        }}
      >
        <span className="dsh-notify-thumb" />
      </button>
    </div>
  )
}
