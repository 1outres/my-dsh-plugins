import {
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { createPortal } from "react-dom"
import { refKey } from "./config"
import type { FavoritesStore } from "./favorites"
import {
  IconCheck,
  IconChevronDown,
  IconClose,
  IconModels,
  IconStar,
  IconWarning,
  Spinner,
} from "./icons"
import {
  buildSections,
  carriedEffort,
  catalogEntries,
  type EffortChoice,
  effectiveEffort,
  effortCaption,
  effortChoices,
  isSelected,
  type ModelEntry,
  providerName,
  stepIndex,
} from "./model"
import type { RecentStore } from "./recent"
import type {
  ModelDirectoryState,
  ModelRef,
  ModelSelection,
  Observable,
  RemoteResult,
  Translate,
} from "./types"

/** Props the composer seat receives: owner share, injected face, and the locale seat. */
export interface PickerProps {
  /** Whether the composer currently refuses interaction. */
  locked: boolean
  /** False for addressed subagent Sessions, which expose no model selection. */
  available: boolean
  /** The Session's shared model directory (the one `/model` reads). */
  directory: Observable<ModelDirectoryState>
  /** Ensure the shared catalog is loaded; failures land on the directory. */
  load: () => void
  /** Submit a complete selection; undefined when the Session cannot select. */
  select: (selection: ModelSelection) => Promise<RemoteResult<void> | undefined>
  favorites: FavoritesStore
  recent: RecentStore
  t: Translate
}

interface PickerRow {
  /** Section id plus model key: the same model may appear in several sections. */
  id: string
  entry: ModelEntry
  showProvider: boolean
}

/** Hidden but laid out at the origin so the first measurement is real. */
const MEASURE_STYLE: CSSProperties = { visibility: "hidden", left: 0, top: 0 }
const MARGIN = 12
const GAP = 8
const ROW_HEIGHT = 34
const TOAST_HOLD_MS = 3000
const TOAST_FADE_MS = 1000

function classes(...names: (string | false | undefined)[]): string {
  return names.filter((name) => typeof name === "string" && name.length > 0).join(" ")
}

function refOf(entry: ModelEntry): ModelRef {
  return { provider: entry.provider.id, model: entry.model.id }
}

function sameName(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

/** Subscribe to an observable store, keeping `this` for class-backed stores. */
function useObservable<T>(observable: Observable<T>): T {
  const subscribe = useCallback(
    (listener: () => void) => observable.subscribe(listener),
    [observable],
  )
  const getSnapshot = useCallback(() => observable.getSnapshot(), [observable])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** The shipped transient toast, anchored over the composer card. */
function PickerToast(props: { text: string; anchor: Element | null; onDone: () => void }) {
  const { text, anchor, onDone } = props
  const done = useRef(onDone)
  done.current = onDone
  const [left, setLeft] = useState<number | null>(null)
  useEffect(() => {
    const timer = setTimeout(() => done.current(), TOAST_HOLD_MS + TOAST_FADE_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [])
  useLayoutEffect(() => {
    if (anchor === null) return
    const place = () => {
      const rect = anchor.getBoundingClientRect()
      setLeft(rect.left + rect.width / 2)
    }
    place()
    window.addEventListener("resize", place)
    return () => {
      window.removeEventListener("resize", place)
    }
  }, [anchor])
  const style = {
    ...(left === null ? {} : { left }),
    "--dsh-mp-toast-hold": `${TOAST_HOLD_MS}ms`,
  } as CSSProperties
  return createPortal(
    <div className="dsh-mp-toast" role="alert" style={style}>
      <span className="dsh-mp-toast-icon" aria-hidden="true">
        <IconWarning />
      </span>
      <span className="dsh-mp-toast-text">{text}</span>
    </div>,
    document.body,
  )
}

/**
 * The composer model seat: the shipped trigger, and a single-pane menu with
 * search, Favorites, Recent, every provider, and an Effort row. Selection goes
 * through the same per-Session directory as `/model`.
 */
export function ModelPicker(props: PickerProps) {
  const { locked, available, directory, load, select, favorites, recent, t } = props
  const state = useObservable(directory)
  const favoriteRefs = useObservable(favorites)
  const recentRefs = useObservable(recent)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [preferFirst, setPreferFirst] = useState(false)
  const [selectionFocus, setSelectionFocus] = useState(false)
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null)
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const lastAction = useRef<"load" | "select">("load")
  /** Set by `show()`: hand the keyboard to search once the menu is placed. */
  const focusSearchOnPlace = useRef(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const footerRef = useRef<HTMLFieldSetElement>(null)
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([])
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()

  const accountName = t("provider.account")
  const defaultLabel = t("effort.default")
  const favoritesLabel = t("section.favorites")
  const recentLabel = t("section.recent")

  const entries = useMemo(
    () => catalogEntries(state.groups, accountName),
    [state.groups, accountName],
  )
  const sections = useMemo(
    () =>
      buildSections({
        entries,
        favorites: favoriteRefs,
        recent: recentRefs,
        query,
        labels: { favorites: favoritesLabel, recent: recentLabel },
      }),
    [entries, favoriteRefs, recentRefs, query, favoritesLabel, recentLabel],
  )
  const rows = useMemo<PickerRow[]>(
    () =>
      sections.flatMap((section) =>
        section.entries.map((entry) => ({
          id: `${section.id}\u0000${entry.key}`,
          entry,
          showProvider: section.kind !== "provider",
        })),
      ),
    [sections],
  )
  const favoriteKeys = useMemo(
    () => new Set(favoriteRefs.map((ref) => refKey(ref.provider, ref.model))),
    [favoriteRefs],
  )

  const current = state.current
  const currentEntry = entries.find((entry) => isSelected(entry, current))
  const reasoning = currentEntry?.model.reasoning
  const effective = effectiveEffort(current, reasoning)
  const caption = effortCaption({
    entry: currentEntry,
    selection: current,
    retainedEffort: state.retainedEffort,
    defaultLabel,
  })
  const choices = useMemo(() => effortChoices(reasoning, defaultLabel), [reasoning, defaultLabel])
  const pending = state.pending
  const busy = pending !== null

  const highlighted = highlightId === null ? -1 : rows.findIndex((row) => row.id === highlightId)
  const currentRow = rows.findIndex((row) => isSelected(row.entry, current))
  const activeIndex =
    rows.length === 0
      ? -1
      : highlighted >= 0
        ? highlighted
        : preferFirst
          ? 0
          : Math.max(0, currentRow)

  const showToast = (text: string) => {
    toastSeq.current += 1
    setToast({ seq: toastSeq.current, text })
  }

  const reload = () => {
    lastAction.current = "load"
    load()
  }

  const close = (restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) {
      queueMicrotask(() => {
        triggerRef.current?.focus()
      })
    }
  }

  const closeAfterSelection = () => {
    setSelectionFocus(true)
    close(true)
  }

  const show = () => {
    setSelectionFocus(false)
    setQuery("")
    setHighlightId(null)
    setPreferFirst(false)
    focusSearchOnPlace.current = true
    setOpen(true)
    reload()
  }

  const changeQuery = (next: string) => {
    setQuery(next)
    setHighlightId(null)
    setPreferFirst(true)
  }

  const highlight = (index: number) => {
    const row = rows[index]
    if (row !== undefined && row.id !== highlightId) setHighlightId(row.id)
  }

  const submit = (selection: ModelSelection, record?: ModelRef) => {
    lastAction.current = "select"
    setSelectionFocus(true)
    triggerRef.current?.focus()
    select(selection).then(
      (result) => {
        if (result === undefined) return
        if (result.ok) {
          if (record !== undefined) recent.push(record)
          if (rootRef.current !== null) closeAfterSelection()
          return
        }
        const { error } = result
        showToast(
          error.code === "session/writer-held"
            ? t("error.sessionInUse")
            : t("error.action", { message: `${error.code}: ${error.message}` }),
        )
      },
      (error: unknown) => {
        showToast(t("error.action", { message: String(error) }))
      },
    )
  }

  const choose = (entry: ModelEntry) => {
    if (isSelected(entry, current)) {
      closeAfterSelection()
      return
    }
    const effort = carriedEffort(effective, entry.model.reasoning)
    submit(
      {
        provider: entry.provider.id,
        model: entry.model.id,
        ...(effort === undefined ? {} : { reasoningEffort: effort }),
      },
      refOf(entry),
    )
  }

  const chooseEffort = (choice: EffortChoice) => {
    if (current === null) return
    if (effective === choice.effort) {
      closeAfterSelection()
      return
    }
    submit({
      provider: current.provider,
      model: current.model,
      ...(choice.effort === undefined ? {} : { reasoningEffort: choice.effort }),
    })
  }

  const toggleFavorite = (entry: ModelEntry) => {
    favorites.toggle(refOf(entry)).then(
      (accepted) => {
        if (!accepted) showToast(t("error.favorites"))
      },
      () => {
        showToast(t("error.favorites"))
      },
    )
  }

  const focusEffort = () => {
    const chips = chipRefs.current.filter((chip): chip is HTMLButtonElement => chip !== null)
    const checked = chips.find((chip) => chip.getAttribute("aria-pressed") === "true")
    ;(checked ?? chips[0])?.focus()
  }

  // Close on a press outside the trigger and the menu.
  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target) === true) return
      if (menuRef.current?.contains(target) === true) return
      setOpen(false)
    }
    document.addEventListener("mousedown", onPointer)
    return () => {
      document.removeEventListener("mousedown", onPointer)
    }
  }, [open])

  // A composer that locks while the menu is open closes it.
  useEffect(() => {
    if (locked && open) setOpen(false)
  }, [locked, open])

  // Opening hands the keyboard to search. The first frame measures the menu
  // with `visibility: hidden`, where focus() is refused, so wait until it is
  // placed; retry on the next frame when something else kept focus.
  const placed = menuPos !== null
  useLayoutEffect(() => {
    if (!open || !placed || !focusSearchOnPlace.current) return
    focusSearchOnPlace.current = false
    const focusSearch = () => {
      const input = searchRef.current
      if (input !== null && document.activeElement !== input) input.focus({ preventScroll: true })
    }
    focusSearch()
    if (document.activeElement === searchRef.current) return
    const frame = requestAnimationFrame(focusSearch)
    return () => {
      cancelAnimationFrame(frame)
    }
  }, [open, placed])

  // Place the menu above the trigger, right-aligned, inside the viewport.
  // biome-ignore lint/correctness/useExhaustiveDependencies: content changes resize the menu
  useLayoutEffect(() => {
    if (!available || !open) {
      setMenuPos(null)
      return
    }
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect === undefined) return
      const width = menuRef.current?.offsetWidth ?? 0
      const height = menuRef.current?.offsetHeight ?? 0
      let left = rect.right - width
      let top = rect.top - GAP - height
      if (width > 0) left = Math.min(Math.max(left, MARGIN), window.innerWidth - width - MARGIN)
      if (height > 0) top = Math.min(Math.max(top, MARGIN), window.innerHeight - height - MARGIN)
      setMenuPos((previous) =>
        previous !== null && previous.left === left && previous.top === top
          ? previous
          : { left, top },
      )
    }
    place()
    window.addEventListener("scroll", place, true)
    window.addEventListener("resize", place)
    const menu = menuRef.current
    const observer =
      typeof ResizeObserver !== "undefined" && menu !== null ? new ResizeObserver(place) : null
    if (menu !== null) observer?.observe(menu)
    return () => {
      observer?.disconnect()
      window.removeEventListener("scroll", place, true)
      window.removeEventListener("resize", place)
    }
  }, [available, open, state, sections, choices])

  // Keep the active row visible below its sticky heading.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new row list re-renders the row elements
  useLayoutEffect(() => {
    if (!open || activeIndex < 0) return
    const list = listRef.current
    const row = rowRefs.current[activeIndex]
    if (list === null || row === null || row === undefined) return
    const listRect = list.getBoundingClientRect()
    const rowRect = row.getBoundingClientRect()
    const top = rowRect.top - listRect.top + list.scrollTop
    const heading = row.closest("section")?.querySelector<HTMLElement>(".dsh-mp-heading")
    const cover = heading?.offsetHeight ?? 0
    if (top - cover < list.scrollTop) list.scrollTop = Math.max(0, top - cover)
    else if (top + rowRect.height > list.scrollTop + list.clientHeight) {
      list.scrollTop = top + rowRect.height - list.clientHeight
    }
  }, [open, activeIndex, rows])

  // Paint a heading's fill only while it is pinned, like the shipped menu groups.
  // biome-ignore lint/correctness/useExhaustiveDependencies: new sections need a fresh pass
  useLayoutEffect(() => {
    const list = listRef.current
    if (!open || list === null) return
    let frame = 0
    const update = () => {
      frame = 0
      const top = list.getBoundingClientRect().top
      for (const heading of list.querySelectorAll<HTMLElement>(".dsh-mp-heading")) {
        const section = heading.parentElement?.getBoundingClientRect()
        const stuck = section !== undefined && section.top < top - 0.5 && section.bottom > top
        if (heading.hasAttribute("data-stuck") !== stuck)
          heading.toggleAttribute("data-stuck", stuck)
      }
    }
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(update)
    }
    update()
    list.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      list.removeEventListener("scroll", onScroll)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [open, sections])

  if (!available) return null

  const pageSize = () =>
    Math.max(1, Math.floor((listRef.current?.clientHeight ?? ROW_HEIGHT * 8) / ROW_HEIGHT) - 1)

  const onRootKeyDown = (event: ReactKeyboardEvent) => {
    if (event.nativeEvent.isComposing || !open) return
    if (event.key === "Escape") {
      // The composer's double-Escape stop ignores handled events.
      event.preventDefault()
      close(true)
      return
    }
    const target = event.target as Node
    if (menuRef.current?.contains(target) !== true) return
    if (footerRef.current?.contains(target) === true) return
    const move = (delta: number, wrap: boolean) => {
      event.preventDefault()
      if (rows.length > 0) highlight(stepIndex(activeIndex, delta, rows.length, wrap))
      searchRef.current?.focus()
    }
    switch (event.key) {
      case "ArrowDown":
        move(1, true)
        return
      case "ArrowUp":
        move(-1, true)
        return
      case "PageDown":
        move(pageSize(), false)
        return
      case "PageUp":
        move(-pageSize(), false)
        return
      case "Home":
      case "End":
        if (event.shiftKey) return
        event.preventDefault()
        if (rows.length > 0) highlight(event.key === "Home" ? 0 : rows.length - 1)
        return
      case "Enter": {
        event.preventDefault()
        const row = rows[activeIndex]
        if (!busy && row !== undefined) choose(row.entry)
        return
      }
      case "Tab":
        event.preventDefault()
        if (event.shiftKey) close(true)
        else focusEffort()
        return
    }
    if (
      event.code === "KeyD" &&
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      !event.shiftKey
    ) {
      // Replaces the browser's bookmark shortcut only while the menu is open.
      event.preventDefault()
      const row = rows[activeIndex]
      if (row !== undefined) toggleFavorite(row.entry)
    }
  }

  const onFooterKeyDown = (event: ReactKeyboardEvent) => {
    if (event.nativeEvent.isComposing) return
    const chips = chipRefs.current.filter((chip): chip is HTMLButtonElement => chip !== null)
    if (chips.length === 0) return
    const index = chips.indexOf(document.activeElement as HTMLButtonElement)
    const focusAt = (next: number) => {
      event.preventDefault()
      chips[next]?.focus()
    }
    switch (event.key) {
      case "ArrowRight":
        focusAt(stepIndex(index, 1, chips.length, true))
        return
      case "ArrowLeft":
        focusAt(stepIndex(index, -1, chips.length, true))
        return
      case "Home":
        focusAt(0)
        return
      case "End":
        focusAt(chips.length - 1)
        return
      case "Tab":
        event.preventDefault()
        searchRef.current?.focus()
        return
    }
  }

  const onBlur = (event: ReactFocusEvent) => {
    const next = event.relatedTarget
    if (
      next instanceof Node &&
      (rootRef.current?.contains(next) === true || menuRef.current?.contains(next) === true)
    ) {
      return
    }
    close()
  }

  // Presses on buttons keep focus in search, so the menu never blurs closed.
  const keepFocus = (event: ReactMouseEvent) => {
    const target = event.target
    if (target instanceof Element && target.closest("button") !== null) event.preventDefault()
  }

  const loading = state.status === "loading"
  const waiting = currentEntry === undefined && loading
  const modelLabel = waiting
    ? t("trigger.loading")
    : (currentEntry?.model.name ?? t("trigger.fallback"))
  const triggerTitle = caption === undefined ? modelLabel : `${modelLabel} · ${caption}`
  const triggerAria = waiting
    ? t("trigger.loading")
    : currentEntry === undefined
      ? t("trigger.selectAria")
      : caption === undefined
        ? t("trigger.aria", { model: modelLabel })
        : t("trigger.ariaEffort", { model: modelLabel, effort: caption })
  const menuId = `${id}-menu`
  const listId = `${id}-models`
  const rowDomId = (index: number) => `${id}-row-${index}`
  const emptyText =
    rows.length > 0 || loading
      ? undefined
      : entries.length === 0
        ? state.status === "ready"
          ? t("empty.models")
          : undefined
        : t("search.empty")

  rowRefs.current.length = rows.length
  chipRefs.current.length = choices.length
  let rowIndex = 0

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the wrapper routes the trigger's and the portaled menu's keyboard and focus events, as the shipped selector does
    <div
      ref={rootRef}
      className="dsh-mp-root"
      onKeyDown={onRootKeyDown}
      onBlur={onBlur}
      onMouseDown={keepFocus}
    >
      <button
        ref={triggerRef}
        type="button"
        className="dsh-mp-trigger"
        aria-label={triggerAria}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-busy={busy}
        title={triggerTitle}
        data-selection-focus={selectionFocus ? "" : undefined}
        disabled={locked}
        onBlur={() => {
          setSelectionFocus(false)
        }}
        onClick={() => {
          if (open) close(true)
          else show()
        }}
      >
        <IconModels className="dsh-mp-trigger-icon" />
        <span className="dsh-mp-trigger-label">
          {currentEntry === undefined ? (
            modelLabel
          ) : (
            <span data-provider-id={currentEntry.provider.id} data-model-id={currentEntry.model.id}>
              {currentEntry.model.name}
            </span>
          )}
        </span>
        {caption !== undefined && <span className="dsh-mp-trigger-effort">{caption}</span>}
        {busy ? (
          <Spinner />
        ) : (
          <IconChevronDown className={classes("dsh-mp-chevron", open && "dsh-mp-chevron-open")} />
        )}
      </button>
      {open &&
        createPortal(
          // biome-ignore lint/a11y/useSemanticElements: the shipped menu surface is a group, not a form fieldset
          <div
            ref={menuRef}
            id={menuId}
            className="dsh-mp-menu"
            data-menu-material="translucent"
            style={menuPos ?? MEASURE_STYLE}
            role="group"
            aria-label={t("menu.aria")}
            aria-busy={loading || busy}
            tabIndex={-1}
          >
            <span className="dsh-mp-material" aria-hidden="true" />
            <div className="dsh-mp-search-row">
              <div className={classes("dsh-mp-search", query !== "" && "dsh-mp-search-with-query")}>
                <input
                  ref={searchRef}
                  type="search"
                  aria-label={t("search.placeholder")}
                  aria-controls={listId}
                  aria-activedescendant={activeIndex < 0 ? undefined : rowDomId(activeIndex)}
                  placeholder={t("search.placeholder")}
                  autoComplete="off"
                  spellCheck={false}
                  value={query}
                  readOnly={busy}
                  onChange={(event) => {
                    changeQuery(event.target.value)
                  }}
                />
              </div>
              {query !== "" && (
                <button
                  type="button"
                  className="dsh-mp-search-clear"
                  aria-label={t("search.clear")}
                  disabled={busy}
                  onClick={() => {
                    changeQuery("")
                    searchRef.current?.focus()
                  }}
                >
                  <IconClose />
                </button>
              )}
            </div>
            {loading && <div className="dsh-mp-status">{t("status.loading")}</div>}
            {state.error !== null && lastAction.current === "load" && (
              <div className="dsh-mp-error">
                <span>{t("error.action", { message: state.error })}</span>
                <button type="button" className="dsh-mp-retry" onClick={reload}>
                  {t("retry")}
                </button>
              </div>
            )}
            {state.failures.map((failure) => (
              <div key={failure.id} className="dsh-mp-warning">
                <span>
                  {t("warning.groupLoad", {
                    name: providerName(failure, accountName),
                    message: failure.message,
                  })}
                </span>
                <button type="button" className="dsh-mp-retry" onClick={reload}>
                  {t("retry")}
                </button>
              </div>
            ))}
            <div
              ref={listRef}
              id={listId}
              className="dsh-mp-list scrollable"
              role="menu"
              aria-label={t("list.aria")}
              tabIndex={-1}
              hidden={rows.length === 0}
            >
              {sections.map((section) => {
                const headingId = `${id}-${section.id}`
                return (
                  // biome-ignore lint/a11y/useSemanticElements: the shipped MenuGroup markup inside role="menu"
                  <section
                    key={section.id}
                    className="dsh-mp-group"
                    role="group"
                    aria-labelledby={section.label === undefined ? undefined : headingId}
                    aria-label={section.label === undefined ? t("section.results") : undefined}
                  >
                    {section.label !== undefined && (
                      <div className="dsh-mp-heading" id={headingId}>
                        {section.label}
                      </div>
                    )}
                    {section.entries.map((entry) => {
                      const index = rowIndex++
                      const row = rows[index]
                      const selected = isSelected(entry, current)
                      const favorite = favoriteKeys.has(entry.key)
                      const active = index === activeIndex
                      const pendingHere = pending !== null && isSelected(entry, pending)
                      const showId = !sameName(entry.model.name, entry.model.id)
                      return (
                        <div key={row?.id ?? entry.key} className="dsh-mp-row">
                          <button
                            ref={(node) => {
                              rowRefs.current[index] = node
                            }}
                            type="button"
                            role="menuitemradio"
                            aria-checked={selected}
                            id={rowDomId(index)}
                            tabIndex={-1}
                            className={classes("dsh-mp-option", active && "dsh-mp-option-active")}
                            data-highlighted={active ? "" : undefined}
                            title={`${entry.provider.name} · ${entry.model.name}${showId ? ` (${entry.model.id})` : ""}`}
                            disabled={busy}
                            onMouseMove={busy || active ? undefined : () => highlight(index)}
                            onClick={() => {
                              choose(entry)
                            }}
                          >
                            <span className="dsh-mp-check">
                              {pendingHere ? <Spinner /> : selected ? <IconCheck /> : null}
                            </span>
                            <span className="dsh-mp-copy">
                              <span
                                className="dsh-mp-name"
                                data-provider-id={entry.provider.id}
                                data-model-id={entry.model.id}
                              >
                                {entry.model.name}
                              </span>
                              {showId && <span className="dsh-mp-id">{entry.model.id}</span>}
                            </span>
                            {row?.showProvider === true && (
                              <span className="dsh-mp-provider">{entry.provider.name}</span>
                            )}
                            <span className="dsh-mp-star-room" />
                          </button>
                          <button
                            type="button"
                            tabIndex={-1}
                            className={classes("dsh-mp-star", favorite && "dsh-mp-star-on")}
                            aria-label={favorite ? t("favorite.remove") : t("favorite.add")}
                            aria-pressed={favorite}
                            title={favorite ? t("favorite.remove") : t("favorite.add")}
                            onMouseMove={active ? undefined : () => highlight(index)}
                            onClick={() => {
                              toggleFavorite(entry)
                            }}
                          >
                            <IconStar filled={favorite} />
                          </button>
                        </div>
                      )
                    })}
                  </section>
                )
              })}
            </div>
            {emptyText !== undefined && (
              <div className="dsh-mp-empty" role="status">
                {emptyText}
              </div>
            )}
            {choices.length > 0 && (
              <fieldset
                ref={footerRef}
                className="dsh-mp-effort"
                aria-label={t("effort.aria")}
                onKeyDown={onFooterKeyDown}
              >
                <span className="dsh-mp-effort-label" aria-hidden="true">
                  {t("effort.label")}
                </span>
                <div className="dsh-mp-chips">
                  {choices.map((choice, index) => {
                    const checked = effective === choice.effort
                    const pendingHere =
                      pending !== null &&
                      current !== null &&
                      pending.provider === current.provider &&
                      pending.model === current.model &&
                      pending.reasoningEffort === choice.effort
                    return (
                      <button
                        key={choice.key}
                        ref={(node) => {
                          chipRefs.current[index] = node
                        }}
                        type="button"
                        aria-pressed={checked}
                        tabIndex={-1}
                        className={classes("dsh-mp-chip", checked && "dsh-mp-chip-on")}
                        disabled={busy}
                        onClick={() => {
                          chooseEffort(choice)
                        }}
                      >
                        {pendingHere && <Spinner size={12} />}
                        {choice.label}
                      </button>
                    )
                  })}
                </div>
              </fieldset>
            )}
          </div>,
          document.body,
        )}
      {toast !== null && (
        <PickerToast
          key={toast.seq}
          text={toast.text}
          anchor={rootRef.current?.closest("[data-composer-card]") ?? null}
          onDone={() => {
            setToast(null)
          }}
        />
      )}
    </div>
  )
}
