import type { CSSProperties } from "react"
import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import { LIMIT_RULES, type LimitField } from "../shared/settings"
import type { AdvisorSettingsController } from "./controller"
import type { Translate } from "./types"

export interface SettingsPageProps {
  readonly controller: AdvisorSettingsController
  readonly t: Translate
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

const statusStyle: CSSProperties = {
  margin: "14px 0 0",
  padding: "8px 10px",
  borderRadius: 8,
  background: "var(--dsw-alias-bg-layer-1)",
  color: "var(--dsw-alias-label-secondary)",
  fontSize: 12,
  lineHeight: 1.6,
}

const groupStyle: CSSProperties = {
  margin: "26px 0 0",
  paddingTop: 18,
  borderTop: "1px solid var(--dsw-alias-border-l2)",
}

const groupTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 14,
  fontWeight: 600,
}

const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  marginTop: 18,
}

const labelStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
}

const hintStyle: CSSProperties = {
  margin: 0,
  color: "var(--dsw-alias-label-tertiary)",
  fontSize: 12,
  lineHeight: 1.5,
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

const selectStyle: CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
}

const buttonStyle: CSSProperties = {
  alignSelf: "flex-start",
  padding: "6px 12px",
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

function useDraft(value: string): [string, (next: string) => void] {
  const [draft, setDraft] = useState(value)
  useEffect(() => {
    setDraft(value)
  }, [value])
  return [draft, setDraft]
}

interface LimitInputProps {
  readonly field: LimitField
  readonly value: number
  readonly disabled: boolean
  readonly error: string | undefined
  readonly controller: AdvisorSettingsController
  readonly t: Translate
}

function LimitInput({ field, value, disabled, error, controller, t }: LimitInputProps) {
  const [draft, setDraft] = useDraft(String(value))
  const rule = LIMIT_RULES[field]
  const id = `dsh-advisor-${field}`
  return (
    <div style={fieldStyle}>
      <label style={labelStyle} htmlFor={id}>
        {t(field)}
      </label>
      <input
        id={id}
        type="number"
        min={rule.min}
        max={rule.max}
        step={1}
        value={draft}
        disabled={disabled}
        style={inputStyle}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void controller.commitLimit(field, draft)}
      />
      <p style={hintStyle}>{t(`${field}Hint`)}</p>
      {error === undefined ? null : <p style={errorStyle}>{t(error)}</p>}
    </div>
  )
}

export function SettingsPage({ controller, t }: SettingsPageProps) {
  const subscribe = useCallback(
    (listener: () => void) => controller.subscribe(listener),
    [controller],
  )
  const getSnapshot = useCallback(() => controller.getSnapshot(), [controller])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  useEffect(() => {
    controller.ensureCatalog()
  }, [controller])

  if (snapshot.status === "unavailable") {
    return <p style={mutedStyle}>{t("unavailable")}</p>
  }

  const { values, catalog, errors } = snapshot
  const disabled = !snapshot.writable
  const configured = snapshot.selectedKey !== ""

  return (
    <div style={sectionStyle}>
      <h2 style={headingStyle}>{t("title")}</h2>
      <p style={introStyle}>{t("description")}</p>
      {snapshot.status === "loading" ? <p style={hintStyle}>{t("loading")}</p> : null}

      <p style={statusStyle}>
        {configured
          ? t("statusOn", { model: `${values.provider}/${values.model}` })
          : t("statusOff")}
      </p>

      <section style={groupStyle}>
        <div style={{ ...fieldStyle, marginTop: 0 }}>
          <label style={labelStyle} htmlFor="dsh-advisor-model">
            {t("model")}
          </label>
          <select
            id="dsh-advisor-model"
            value={snapshot.selectedKey}
            disabled={disabled}
            style={selectStyle}
            onChange={(event) => void controller.selectRoute(event.target.value)}
          >
            <option value="">{t("modelOff")}</option>
            {snapshot.routeGroups.map((group) => (
              <optgroup key={group.id} label={group.name}>
                {group.routes.map((route) => (
                  <option key={route.key} value={route.key}>
                    {route.available ? route.name : t("modelUnavailable", { name: route.name })}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <p style={hintStyle}>{t("modelHint")}</p>
          {catalog.status === "loading" ? <p style={hintStyle}>{t("catalogLoading")}</p> : null}
          {catalog.partial ? <p style={hintStyle}>{t("catalogPartial")}</p> : null}
          {catalog.status === "error" ? (
            <>
              <p style={errorStyle}>{t("catalogError", { message: catalog.error })}</p>
              <button type="button" style={buttonStyle} onClick={() => controller.refreshCatalog()}>
                {t("retry")}
              </button>
            </>
          ) : null}
        </div>

        {snapshot.efforts.length === 0 ? null : (
          <div style={fieldStyle}>
            <label style={labelStyle} htmlFor="dsh-advisor-effort">
              {t("reasoningEffort")}
            </label>
            <select
              id="dsh-advisor-effort"
              value={values.reasoningEffort}
              disabled={disabled}
              style={selectStyle}
              onChange={(event) => void controller.selectEffort(event.target.value)}
            >
              <option value="">{t("effortDefault")}</option>
              {snapshot.efforts.map((effort) => (
                <option key={effort.id} value={effort.id}>
                  {effort.name}
                </option>
              ))}
            </select>
            <p style={hintStyle}>{t("reasoningEffortHint")}</p>
          </div>
        )}
      </section>

      <section style={groupStyle}>
        <h3 style={groupTitleStyle}>{t("limits")}</h3>
        <LimitInput
          field="adviceWordLimit"
          value={values.adviceWordLimit}
          disabled={disabled}
          error={errors.adviceWordLimit}
          controller={controller}
          t={t}
        />
        <LimitInput
          field="timeoutMs"
          value={values.timeoutMs}
          disabled={disabled}
          error={errors.timeoutMs}
          controller={controller}
          t={t}
        />
      </section>

      {disabled ? <p style={hintStyle}>{t("readOnly")}</p> : null}
      {snapshot.writeError ? <p style={errorStyle}>{t("writeError")}</p> : null}
    </div>
  )
}
