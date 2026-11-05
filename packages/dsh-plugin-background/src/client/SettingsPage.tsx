import { Switch } from "@deepseek-ai/dsh-client-ui-primitives"
import type { ChangeEvent, CSSProperties, KeyboardEvent } from "react"
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { normalizeConfig } from "./config"
import { clamp, dimColor, imageCssValue, resolveImageSource } from "./format"
import type { BackgroundConfig, ConfigForm, Translate } from "./types"

export interface SettingsPageProps {
  form: ConfigForm<BackgroundConfig>
  t: Translate
}

const FIELDS = ["enabled", "image", "panelOpacity", "dim", "blur"] as const

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

const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  marginTop: 22,
}

const labelRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  fontSize: 13,
  fontWeight: 600,
}

const hintStyle: CSSProperties = {
  margin: 0,
  color: "var(--dsw-alias-label-tertiary)",
  fontSize: 12,
  lineHeight: 1.5,
}

const switchHintStyle: CSSProperties = {
  ...hintStyle,
  marginTop: 4,
}

const switchRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 24,
  marginTop: 22,
}

const switchTitleStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
}

const errorStyle: CSSProperties = {
  margin: 0,
  color: "var(--dsw-alias-state-error-primary)",
  fontSize: 12,
  lineHeight: 1.5,
}

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--dsw-alias-border-l2)",
  background: "var(--dsw-specific-input-major, var(--dsw-alias-bg-layer-1))",
  color: "inherit",
  font: "inherit",
  outline: "none",
}

const sliderStyle: CSSProperties = {
  width: "100%",
  accentColor: "var(--dsw-alias-brand-primary)",
}

const previewStyle: CSSProperties = {
  position: "relative",
  height: 180,
  marginTop: 16,
  borderRadius: 10,
  overflow: "hidden",
  border: "1px solid var(--dsw-alias-border-l2)",
  background: "var(--dsw-alias-bg-layer-2)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
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

const mutedStyle: CSSProperties = {
  color: "var(--dsw-alias-label-tertiary)",
  fontSize: 13,
  lineHeight: 1.6,
}

/** How long a paused or abandoned drag may sit before its value reaches the Host. */
const SLIDER_COMMIT_DELAY = 300

interface SliderDraft {
  /** Value the thumb and the preview render; ahead of the Host while dragging. */
  value: number
  /** Adopt a new value immediately and schedule the Host write. */
  change: (next: number) => void
  /** Hand the pending value to the Host now, when the gesture ends. */
  flush: () => void
}

/**
 * Range input state that keeps the thumb under the pointer.
 *
 * Driving a controlled range input straight from the `configForms` snapshot
 * round-trips every input event to the Host. Each answer replaces the snapshot
 * with an older value, so the thumb is dragged back and a fast drag turns into
 * a fight with the pointer. Keep a local draft, commit once the gesture settles,
 * and ignore Host answers while a local write is still in flight: those echoes
 * describe values from earlier in the same drag.
 */
function useSliderDraft(
  committed: number,
  commit: (value: number) => Promise<boolean>,
): SliderDraft {
  const [value, setValue] = useState(committed)
  const latest = useRef(committed)
  const dirty = useRef(false)
  const inFlight = useRef(0)
  const timer = useRef<number | undefined>(undefined)

  // Adopt Host-side changes (reset, another window) only while no local value is queued.
  useEffect(() => {
    if (dirty.current || inFlight.current > 0) return
    latest.current = committed
    setValue(committed)
  }, [committed])

  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
    },
    [],
  )

  const send = () => {
    window.clearTimeout(timer.current)
    timer.current = undefined
    if (!dirty.current) return
    dirty.current = false
    const sent = latest.current
    inFlight.current += 1
    void commit(sent).then((accepted) => {
      inFlight.current -= 1
      if (accepted || dirty.current || inFlight.current > 0) return
      // A refused write leaves the draft ahead of the Host; show what it kept.
      latest.current = committed
      setValue(committed)
    })
  }

  const change = (next: number) => {
    if (next === latest.current) return
    latest.current = next
    dirty.current = true
    setValue(next)
    // A lost pointerup or assistive input still settles; a flush cancels this.
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(send, SLIDER_COMMIT_DELAY)
  }

  const flush = () => {
    send()
  }

  return { value, change, flush }
}

/** Settings page: image source plus the three readability controls. */
export function SettingsPage({ form, t }: SettingsPageProps) {
  const subscribe = useCallback((listener: () => void) => form.subscribe(listener), [form])
  const getSnapshot = useCallback(() => form.getSnapshot(), [form])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const config = normalizeConfig(snapshot.value)

  const [draft, setDraft] = useState(config.image)
  const [previewFailure, setPreviewFailure] = useState<{ src: string; failed: boolean } | null>(
    null,
  )
  const [writeError, setWriteError] = useState(false)

  useEffect(() => {
    setDraft(config.image)
  }, [config.image])

  const source = resolveImageSource(config.image, document.baseURI)
  const draftSource = resolveImageSource(draft, document.baseURI)
  const draftInvalid = draft.trim().length > 0 && draftSource === undefined
  const previewFailed =
    previewFailure !== null && previewFailure.src === source && previewFailure.failed

  const write = (field: string, value: unknown): Promise<boolean> =>
    form.set(field, value).then(
      (accepted) => {
        setWriteError(!accepted)
        return accepted
      },
      () => {
        setWriteError(true)
        return false
      },
    )

  const opacitySlider = useSliderDraft(config.panelOpacity, (value) => write("panelOpacity", value))
  const dimSlider = useSliderDraft(config.dim, (value) => write("dim", value))
  const blurSlider = useSliderDraft(config.blur, (value) => write("blur", value))

  const commitImage = () => {
    const next = draft.trim()
    if (next !== config.image) void write("image", next)
  }

  const onImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    setDraft(event.target.value)
  }

  const onImageKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault()
      event.currentTarget.blur()
    }
  }

  const reset = () => {
    void Promise.all(FIELDS.map((field) => form.unset(field)))
      .then((results) => setWriteError(results.some((accepted) => !accepted)))
      .catch(() => setWriteError(true))
  }

  if (snapshot.status === "unavailable") {
    return <p style={mutedStyle}>{t("unavailable")}</p>
  }

  const disabled = snapshot.writable === false
  const dim = dimColor(dimSlider.value)
  const alpha = clamp(opacitySlider.value, 0, 100) / 100
  const blur = clamp(blurSlider.value, 0, 40)
  const dark = document.body.hasAttribute("data-ds-dark-theme")
  const surfaceColor = dark ? `rgba(21, 21, 23, ${alpha})` : `rgba(255, 255, 255, ${alpha})`
  const surfaceText = dark ? "#e9ecf2" : "#0f1115"

  return (
    <div style={sectionStyle}>
      <h2 style={headingStyle}>{t("title")}</h2>
      <p style={introStyle}>{t("description")}</p>

      <div style={switchRowStyle}>
        <div style={{ minWidth: 0 }}>
          <div style={switchTitleStyle}>{t("enable")}</div>
          <p style={switchHintStyle}>{t("enableHint")}</p>
        </div>
        <Switch
          checked={config.enabled}
          disabled={disabled}
          label={t("enable")}
          title={disabled ? t("readOnly") : undefined}
          onChange={(next) => {
            void write("enabled", next)
          }}
        />
      </div>

      <div style={fieldStyle}>
        <label style={labelRowStyle} htmlFor="dsh-background-image">
          <span>{t("image")}</span>
        </label>
        <input
          id="dsh-background-image"
          type="text"
          spellCheck={false}
          autoComplete="off"
          placeholder="/home/you/wallpaper.jpg"
          value={draft}
          disabled={disabled}
          style={inputStyle}
          onChange={onImageChange}
          onBlur={commitImage}
          onKeyDown={onImageKeyDown}
        />
        <p style={hintStyle}>{t("imageHint")}</p>
        {draftInvalid ? <p style={errorStyle}>{t("invalidImage")}</p> : null}
      </div>

      <div style={fieldStyle}>
        <span style={labelRowStyle}>{t("preview")}</span>
        <div style={previewStyle}>
          {source ? (
            <>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  backgroundImage: imageCssValue(source),
                  backgroundPosition: "center",
                  backgroundSize: "cover",
                  filter: `blur(${blur}px)`,
                  transform: "scale(1.06)",
                }}
              />
              <div style={{ position: "absolute", inset: 0, background: dim }} />
              <div
                style={{
                  position: "relative",
                  padding: "12px 16px",
                  borderRadius: 10,
                  maxWidth: "72%",
                  textAlign: "center",
                  background: surfaceColor,
                  color: surfaceText,
                  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.18)",
                }}
              >
                <strong style={{ display: "block", fontSize: 13 }}>{t("previewTitle")}</strong>
                <span style={{ display: "block", marginTop: 4, fontSize: 12, opacity: 0.75 }}>
                  {t("previewBody")}
                </span>
              </div>
              <img
                src={source}
                alt=""
                style={{ display: "none" }}
                onError={() => setPreviewFailure({ src: source, failed: true })}
                onLoad={() => setPreviewFailure({ src: source, failed: false })}
              />
              {previewFailed ? (
                <span
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "rgba(0, 0, 0, 0.55)",
                    color: "#fff",
                    fontSize: 12,
                  }}
                >
                  {t("previewFailed")}
                </span>
              ) : null}
            </>
          ) : (
            <span style={mutedStyle}>{t("previewEmpty")}</span>
          )}
        </div>
      </div>

      <div style={fieldStyle}>
        <label style={labelRowStyle} htmlFor="dsh-background-panel-opacity">
          <span>{t("panelOpacity")}</span>
          <span style={mutedStyle}>{Math.round(opacitySlider.value)}%</span>
        </label>
        <input
          id="dsh-background-panel-opacity"
          type="range"
          min={0}
          max={100}
          step={1}
          value={opacitySlider.value}
          disabled={disabled}
          style={sliderStyle}
          onChange={(event) => opacitySlider.change(Number(event.target.value))}
          onPointerUp={opacitySlider.flush}
          onPointerCancel={opacitySlider.flush}
          onKeyUp={opacitySlider.flush}
          onBlur={opacitySlider.flush}
        />
        <p style={hintStyle}>{t("panelOpacityHint")}</p>
      </div>

      <div style={fieldStyle}>
        <label style={labelRowStyle} htmlFor="dsh-background-dim">
          <span>{t("dim")}</span>
          <span style={mutedStyle}>{Math.round(dimSlider.value)}%</span>
        </label>
        <input
          id="dsh-background-dim"
          type="range"
          min={0}
          max={100}
          step={1}
          value={dimSlider.value}
          disabled={disabled}
          style={sliderStyle}
          onChange={(event) => dimSlider.change(Number(event.target.value))}
          onPointerUp={dimSlider.flush}
          onPointerCancel={dimSlider.flush}
          onKeyUp={dimSlider.flush}
          onBlur={dimSlider.flush}
        />
        <p style={hintStyle}>{t("dimHint")}</p>
      </div>

      <div style={fieldStyle}>
        <label style={labelRowStyle} htmlFor="dsh-background-blur">
          <span>{t("blur")}</span>
          <span style={mutedStyle}>{Math.round(blurSlider.value)} px</span>
        </label>
        <input
          id="dsh-background-blur"
          type="range"
          min={0}
          max={40}
          step={1}
          value={blurSlider.value}
          disabled={disabled}
          style={sliderStyle}
          onChange={(event) => blurSlider.change(Number(event.target.value))}
          onPointerUp={blurSlider.flush}
          onPointerCancel={blurSlider.flush}
          onKeyUp={blurSlider.flush}
          onBlur={blurSlider.flush}
        />
        <p style={hintStyle}>{t("blurHint")}</p>
      </div>

      {snapshot.writable === false ? <p style={hintStyle}>{t("readOnly")}</p> : null}
      {writeError ? <p style={errorStyle}>{t("writeError")}</p> : null}

      <button type="button" style={buttonStyle} onClick={reset} disabled={disabled}>
        {t("reset")}
      </button>
    </div>
  )
}
