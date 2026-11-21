import type { CSSProperties } from "react"
import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import { formatDomains, SEARCH_CONTENTS, SEARCH_TYPES } from "./config"
import { type ExaSettingsController, NUMBER_RULES } from "./controller"
import type { SearchContents, SearchType, Translate } from "./types"

export interface SettingsPageProps {
  controller: ExaSettingsController
  t: Translate
}

const SEARCH_TYPE_LABELS: Record<SearchType, string> = {
  auto: "typeAuto",
  lite: "typeLite",
  "deep-lite": "typeDeepLite",
  deep: "typeDeep",
}

const SEARCH_CONTENTS_LABELS: Record<SearchContents, string> = {
  highlights: "contentsHighlights",
  text: "contentsText",
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

const textareaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: 68,
  resize: "vertical",
  fontFamily: "inherit",
}

const selectStyle: CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
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

const advancedStyle: CSSProperties = {
  marginTop: 22,
  borderTop: "1px solid var(--dsw-alias-border-l2)",
  paddingTop: 14,
}

const summaryStyle: CSSProperties = {
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
}

const mutedStyle: CSSProperties = {
  color: "var(--dsw-alias-label-tertiary)",
  fontSize: 13,
  lineHeight: 1.6,
}

/** A text draft that follows Host changes until the reader edits it. */
function useDraft(value: string): [string, (next: string) => void] {
  const [draft, setDraft] = useState(value)
  useEffect(() => {
    setDraft(value)
  }, [value])
  return [draft, setDraft]
}

/** Settings page: provider status, the API key, and the search options. */
export function SettingsPage({ controller, t }: SettingsPageProps) {
  const subscribe = useCallback(
    (listener: () => void) => controller.subscribe(listener),
    [controller],
  )
  const getSnapshot = useCallback(() => controller.getSnapshot(), [controller])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const { config, credential, errors } = snapshot

  const [key, setKey] = useState("")
  const [keyBusy, setKeyBusy] = useState(false)
  const [baseURL, setBaseURL] = useDraft(config.baseURL)
  const [apiKeyEnv, setApiKeyEnv] = useDraft(config.apiKeyEnv)
  const [includeDomains, setIncludeDomains] = useDraft(formatDomains(config.includeDomains))
  const [excludeDomains, setExcludeDomains] = useDraft(formatDomains(config.excludeDomains))
  const [searchMaxCharacters, setSearchMaxCharacters] = useDraft(String(config.searchMaxCharacters))
  const [fetchMaxCharacters, setFetchMaxCharacters] = useDraft(String(config.fetchMaxCharacters))

  if (snapshot.status === "unavailable") {
    return <p style={mutedStyle}>{t("unavailable")}</p>
  }

  const disabled = snapshot.writable === false
  const keyDisabled = disabled || credential.writable === false
  const keyReady = key.trim().length > 0 && !keyBusy

  const saveKey = async () => {
    if (!keyReady) return
    setKeyBusy(true)
    try {
      const saved = await controller.saveKey(key.trim())
      if (saved) setKey("")
    } finally {
      setKeyBusy(false)
    }
  }

  const removeKey = async () => {
    setKeyBusy(true)
    try {
      await controller.removeKey()
    } finally {
      setKeyBusy(false)
    }
  }

  return (
    <div style={sectionStyle}>
      <h2 style={headingStyle}>{t("title")}</h2>
      <p style={introStyle}>{t("description")}</p>
      {snapshot.status === "loading" ? <p style={hintStyle}>{t("loading")}</p> : null}

      <p style={statusStyle}>
        {t("statusSearch")}: {snapshot.web.search ? t("statusOn") : t("statusOff")} ·{" "}
        {t("statusFetch")}: {snapshot.web.fetch ? t("statusOn") : t("statusOff")}
      </p>

      <section style={groupStyle}>
        <h3 style={groupTitleStyle}>{t("apiKey")}</h3>
        <div style={fieldStyle}>
          <input
            id="dsh-exa-api-key"
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            value={key}
            disabled={keyDisabled}
            placeholder={credential.configured ? "••••••••" : ""}
            style={inputStyle}
            onChange={(event) => setKey(event.target.value)}
          />
          <p style={hintStyle}>{t("apiKeyHint")}</p>
          {credential.error !== undefined ? (
            <p style={errorStyle}>{credential.error}</p>
          ) : credential.configured ? (
            <p style={hintStyle}>
              {credential.source === undefined
                ? t("apiKeySetNoSource")
                : t("apiKeySet", { source: credential.source })}
            </p>
          ) : (
            <p style={hintStyle}>{t("apiKeyUnset")}</p>
          )}
          {credential.configured && !credential.writable ? (
            <p style={hintStyle}>{t("apiKeyEnvironment")}</p>
          ) : null}
          <div>
            <button
              type="button"
              style={buttonStyle}
              disabled={!keyReady || keyDisabled}
              onClick={() => void saveKey()}
            >
              {keyBusy ? t("savingKey") : t("saveKey")}
            </button>
            {credential.configured && credential.writable ? (
              <button
                type="button"
                style={buttonStyle}
                disabled={keyBusy || disabled}
                onClick={() => void removeKey()}
              >
                {t("removeKey")}
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <section style={groupStyle}>
        <h3 style={groupTitleStyle}>{t("options")}</h3>

        <div style={fieldStyle}>
          <label style={labelRowStyle} htmlFor="dsh-exa-search-type">
            <span>{t("searchType")}</span>
          </label>
          <select
            id="dsh-exa-search-type"
            value={config.searchType}
            disabled={disabled}
            style={selectStyle}
            onChange={(event) =>
              void controller.commitSelect("searchType", event.target.value as SearchType)
            }
          >
            {SEARCH_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(SEARCH_TYPE_LABELS[type])}
              </option>
            ))}
          </select>
          <p style={hintStyle}>{t("searchTypeHint")}</p>
        </div>

        <div style={fieldStyle}>
          <label style={labelRowStyle} htmlFor="dsh-exa-search-contents">
            <span>{t("searchContents")}</span>
          </label>
          <select
            id="dsh-exa-search-contents"
            value={config.searchContents}
            disabled={disabled}
            style={selectStyle}
            onChange={(event) =>
              void controller.commitSelect("searchContents", event.target.value as SearchContents)
            }
          >
            {SEARCH_CONTENTS.map((contents) => (
              <option key={contents} value={contents}>
                {t(SEARCH_CONTENTS_LABELS[contents])}
              </option>
            ))}
          </select>
          <p style={hintStyle}>{t("searchContentsHint")}</p>
        </div>

        <div style={fieldStyle}>
          <label style={labelRowStyle} htmlFor="dsh-exa-search-max-characters">
            <span>{t("searchMaxCharacters")}</span>
          </label>
          <input
            id="dsh-exa-search-max-characters"
            type="number"
            min={NUMBER_RULES.searchMaxCharacters.min}
            max={NUMBER_RULES.searchMaxCharacters.max}
            step={1}
            value={searchMaxCharacters}
            disabled={disabled}
            style={inputStyle}
            onChange={(event) => setSearchMaxCharacters(event.target.value)}
            onBlur={() => void controller.commitNumber("searchMaxCharacters", searchMaxCharacters)}
          />
          <p style={hintStyle}>{t("searchMaxCharactersHint")}</p>
          {errors.searchMaxCharacters === undefined ? null : (
            <p style={errorStyle}>{t(errors.searchMaxCharacters)}</p>
          )}
        </div>

        <div style={fieldStyle}>
          <label style={labelRowStyle} htmlFor="dsh-exa-include-domains">
            <span>{t("includeDomains")}</span>
          </label>
          <textarea
            id="dsh-exa-include-domains"
            rows={3}
            spellCheck={false}
            value={includeDomains}
            disabled={disabled}
            style={textareaStyle}
            onChange={(event) => setIncludeDomains(event.target.value)}
            onBlur={() => void controller.commitDomains("includeDomains", includeDomains)}
          />
          <p style={hintStyle}>{t("includeDomainsHint")}</p>
        </div>

        <div style={fieldStyle}>
          <label style={labelRowStyle} htmlFor="dsh-exa-exclude-domains">
            <span>{t("excludeDomains")}</span>
          </label>
          <textarea
            id="dsh-exa-exclude-domains"
            rows={3}
            spellCheck={false}
            value={excludeDomains}
            disabled={disabled}
            style={textareaStyle}
            onChange={(event) => setExcludeDomains(event.target.value)}
            onBlur={() => void controller.commitDomains("excludeDomains", excludeDomains)}
          />
          <p style={hintStyle}>{t("excludeDomainsHint")}</p>
        </div>

        <div style={fieldStyle}>
          <label style={labelRowStyle} htmlFor="dsh-exa-fetch-max-characters">
            <span>{t("fetchMaxCharacters")}</span>
          </label>
          <input
            id="dsh-exa-fetch-max-characters"
            type="number"
            min={NUMBER_RULES.fetchMaxCharacters.min}
            max={NUMBER_RULES.fetchMaxCharacters.max}
            step={1}
            value={fetchMaxCharacters}
            disabled={disabled}
            style={inputStyle}
            onChange={(event) => setFetchMaxCharacters(event.target.value)}
            onBlur={() => void controller.commitNumber("fetchMaxCharacters", fetchMaxCharacters)}
          />
          <p style={hintStyle}>{t("fetchMaxCharactersHint")}</p>
          {errors.fetchMaxCharacters === undefined ? null : (
            <p style={errorStyle}>{t(errors.fetchMaxCharacters)}</p>
          )}
        </div>

        <div style={fieldStyle}>
          <label style={labelRowStyle} htmlFor="dsh-exa-base-url">
            <span>{t("baseURL")}</span>
          </label>
          <input
            id="dsh-exa-base-url"
            type="text"
            spellCheck={false}
            autoComplete="off"
            value={baseURL}
            disabled={disabled}
            style={inputStyle}
            onChange={(event) => setBaseURL(event.target.value)}
            onBlur={() => void controller.commitText("baseURL", baseURL)}
          />
          <p style={hintStyle}>{t("baseURLHint")}</p>
          {errors.baseURL === undefined ? null : <p style={errorStyle}>{t(errors.baseURL)}</p>}
        </div>
      </section>

      <details style={advancedStyle}>
        <summary style={summaryStyle}>{t("advanced")}</summary>
        <div style={fieldStyle}>
          <label style={labelRowStyle} htmlFor="dsh-exa-api-key-env">
            <span>{t("apiKeyEnv")}</span>
          </label>
          <input
            id="dsh-exa-api-key-env"
            type="text"
            spellCheck={false}
            autoComplete="off"
            value={apiKeyEnv}
            disabled={disabled}
            style={inputStyle}
            onChange={(event) => setApiKeyEnv(event.target.value)}
            onBlur={() => void controller.commitText("apiKeyEnv", apiKeyEnv)}
          />
          <p style={hintStyle}>{t("apiKeyEnvHint")}</p>
          {errors.apiKeyEnv === undefined ? null : <p style={errorStyle}>{t(errors.apiKeyEnv)}</p>}
        </div>
      </details>

      {disabled ? <p style={hintStyle}>{t("readOnly")}</p> : null}
      {snapshot.writeError ? <p style={errorStyle}>{t("writeError")}</p> : null}
    </div>
  )
}
