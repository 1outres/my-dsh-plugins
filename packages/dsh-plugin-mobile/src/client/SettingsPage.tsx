import type { CSSProperties } from "react"
import { useCallback, useState, useSyncExternalStore } from "react"
import { DEFAULT_CONFIG, normalizeConfig } from "./config"
import type {
  ConfigForm,
  EnterKey,
  InstallOutcome,
  MobileConfig,
  Observable,
  PageState,
  PwaState,
  Translate,
} from "./types"

export interface SettingsPageProps {
  form: ConfigForm<Partial<MobileConfig>>
  page: Observable<PageState>
  pwa: Observable<PwaState>
  install: () => Promise<InstallOutcome>
  t: Translate
}

const FIELDS = Object.keys(DEFAULT_CONFIG) as (keyof MobileConfig)[]
const ENTER_KEYS: readonly EnterKey[] = ["newline", "send"]

const sectionStyle: CSSProperties = {
  maxWidth: 680,
  padding: "4px 0 32px",
  color: "var(--dsw-alias-label-primary)",
}

const headingStyle: CSSProperties = { margin: 0, fontSize: 18, fontWeight: 600, lineHeight: 1.4 }

const groupHeadingStyle: CSSProperties = { margin: "0 0 4px", fontSize: 14, fontWeight: 600 }

const introStyle: CSSProperties = {
  margin: "8px 0 0",
  color: "var(--dsw-alias-label-secondary)",
  fontSize: 13,
  lineHeight: 1.6,
}

const statusStyle: CSSProperties = {
  margin: "12px 0 0",
  padding: "8px 10px",
  borderRadius: 8,
  background: "var(--dsw-alias-interactive-bg-hover)",
  color: "var(--dsw-alias-label-secondary)",
  fontSize: 12,
  lineHeight: 1.5,
}

const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  marginTop: 22,
}

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  marginTop: 20,
}

const labelStyle: CSSProperties = { fontSize: 13, fontWeight: 600 }

const hintStyle: CSSProperties = {
  margin: 0,
  color: "var(--dsw-alias-label-tertiary)",
  fontSize: 12,
  lineHeight: 1.5,
  fontWeight: 400,
}

const errorStyle: CSSProperties = {
  margin: 0,
  color: "var(--dsw-alias-state-error-primary)",
  fontSize: 12,
  lineHeight: 1.5,
}

const groupStyle: CSSProperties = {
  margin: "26px 0 0",
  paddingTop: 4,
  borderTop: "1px solid var(--dsw-alias-border-l2)",
}

const buttonStyle: CSSProperties = {
  marginTop: 26,
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid var(--dsw-alias-border-l2)",
  background: "var(--dsw-alias-bg-layer-1)",
  color: "inherit",
  font: "inherit",
  cursor: "pointer",
}

const installButtonStyle: CSSProperties = { ...buttonStyle, marginTop: 12 }

const mutedStyle: CSSProperties = {
  color: "var(--dsw-alias-label-tertiary)",
  fontSize: 13,
  lineHeight: 1.6,
}

function useObservable<T>(observable: Observable<T>): T {
  const subscribe = useCallback(
    (listener: () => void) => observable.subscribe(listener),
    [observable],
  )
  const getSnapshot = useCallback(() => observable.getSnapshot(), [observable])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function subscribeResize(listener: () => void): () => void {
  window.addEventListener("resize", listener)
  return () => window.removeEventListener("resize", listener)
}

function useViewportWidth(): number {
  return useSyncExternalStore(
    subscribeResize,
    () => Math.round(window.innerWidth),
    () => 0,
  )
}

/**
 * Settings page: the app status, install and title bar, then Enter, the drawer
 * swipe, the keyboard fit and the two touch guards. Every control writes one
 * field; the browser half picks it up at once.
 */
export function SettingsPage({ form, page, pwa, install, t }: SettingsPageProps) {
  const subscribe = useCallback((listener: () => void) => form.subscribe(listener), [form])
  const getSnapshot = useCallback(() => form.getSnapshot(), [form])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const config = normalizeConfig(snapshot.value)
  const state = useObservable(page)
  const pwaState = useObservable(pwa)
  const width = useViewportWidth()

  const [writeFailed, setWriteFailed] = useState(false)

  const write = (field: keyof MobileConfig, value: unknown) => {
    void form
      .set(field, value)
      .then((accepted) => setWriteFailed(!accepted))
      .catch(() => setWriteFailed(true))
  }

  const reset = () => {
    void Promise.all(FIELDS.map((field) => form.unset(field)))
      .then((results) => setWriteFailed(results.some((accepted) => !accepted)))
      .catch(() => setWriteFailed(true))
  }

  if (snapshot.status === "unavailable") {
    return <p style={mutedStyle}>{t("settings.unavailable")}</p>
  }

  const disabled = snapshot.writable === false

  return (
    <div style={sectionStyle} className="dsh-mobile-settings">
      <h2 style={headingStyle}>{t("settings.title")}</h2>
      <p style={introStyle}>{t("settings.description")}</p>
      <p style={statusStyle} role="status">
        {state.mobile
          ? t("settings.statusMobile", { width })
          : t("settings.statusDesktop", { width })}
      </p>

      <div style={groupStyle}>
        <h3 style={groupHeadingStyle}>{t("settings.app")}</h3>
        <p style={statusStyle} role="status">
          {pwaState.standalone ? t("settings.appInstalled") : t("settings.appBrowser")}
          {" · "}
          {t("settings.workerStatus")}: {t(`settings.worker.${pwaState.worker}`)}
        </p>
        {pwaState.installable ? (
          <button type="button" style={installButtonStyle} onClick={() => void install()}>
            {t("settings.install")}
          </button>
        ) : null}
        {pwaState.platform === "ios" && !pwaState.standalone ? (
          <p style={{ ...hintStyle, marginTop: 8 }}>{t("settings.installHint")}</p>
        ) : null}
        <Toggle
          label={t("settings.serviceWorker")}
          hint={t("settings.serviceWorkerHint")}
          checked={config.serviceWorker}
          disabled={disabled}
          onChange={(next) => write("serviceWorker", next)}
        />
        <Toggle
          label={t("settings.themeColor")}
          hint={t("settings.themeColorHint")}
          checked={config.themeColor}
          disabled={disabled}
          onChange={(next) => write("themeColor", next)}
        />
        <p style={{ ...hintStyle, marginTop: 12 }}>{t("settings.pushHint")}</p>
      </div>

      <div style={fieldStyle}>
        <span style={labelStyle}>{t("settings.enterKey")}</span>
        <Segmented
          label={t("settings.enterKey")}
          options={ENTER_KEYS.map((value) => ({
            value,
            label: t(`settings.enterKey.${value}`),
          }))}
          value={config.enterKey}
          disabled={disabled}
          onChange={(next) => write("enterKey", next)}
        />
        <p style={hintStyle}>{t("settings.enterKeyHint")}</p>
      </div>

      <div style={groupStyle}>
        <Toggle
          label={t("settings.autoFocusComposer")}
          hint={t("settings.autoFocusComposerHint")}
          checked={config.autoFocusComposer}
          disabled={disabled}
          onChange={(next) => write("autoFocusComposer", next)}
        />
        <Toggle
          label={t("settings.swipe")}
          hint={t("settings.swipeHint")}
          checked={config.swipe}
          disabled={disabled}
          onChange={(next) => write("swipe", next)}
        />
        <Toggle
          label={t("settings.fitKeyboard")}
          hint={t("settings.fitKeyboardHint")}
          checked={config.fitKeyboard}
          disabled={disabled}
          onChange={(next) => write("fitKeyboard", next)}
        />
        <Toggle
          label={t("settings.blockPullToRefresh")}
          hint={t("settings.blockPullToRefreshHint")}
          checked={config.blockPullToRefresh}
          disabled={disabled}
          onChange={(next) => write("blockPullToRefresh", next)}
        />
      </div>

      {disabled ? <p style={{ ...hintStyle, marginTop: 20 }}>{t("settings.readOnly")}</p> : null}
      {writeFailed ? (
        <p style={{ ...errorStyle, marginTop: 20 }}>{t("settings.writeError")}</p>
      ) : null}

      <button type="button" style={buttonStyle} disabled={disabled} onClick={reset}>
        {t("settings.reset")}
      </button>
    </div>
  )
}

interface SegmentedProps<T extends string> {
  label: string
  options: readonly { value: T; label: string }[]
  value: T
  disabled: boolean
  onChange: (next: T) => void
}

function Segmented<T extends string>({
  label,
  options,
  value,
  disabled,
  onChange,
}: SegmentedProps<T>) {
  return (
    <fieldset className="dsh-mobile-segmented" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          className="dsh-mobile-segment"
          disabled={disabled}
          onClick={() => {
            if (option.value !== value) onChange(option.value)
          }}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
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
    <div style={rowStyle}>
      <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        <span style={labelStyle}>{label}</span>
        <span style={hintStyle}>{hint}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className="dsh-mobile-switch"
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation()
          onChange(!checked)
        }}
      >
        <span className="dsh-mobile-thumb" />
      </button>
    </div>
  )
}
