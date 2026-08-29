import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useDashboardStore } from '../store'
import { getIgnoredVariableIds, getVariablesFilter, nextId, setIgnoredVariableIds, setVariablesFilter } from '../id'
import { useEscapeToClose } from '../useEscapeToClose'
import { uniqueVariableName } from '../variableNaming'
import type { Variable, VariableValue } from '@shared/types'

// Above this row count, a list renders through @tanstack/react-virtual
// instead of a plain .map() — small dashboards (the common case: a handful
// of manual variables, maybe a clock source) never pay any virtualization
// cost at all. Same threshold/library used by EventsModal's field browser,
// so there's exactly one virtualization approach in the app, not two.
const VIRTUALIZE_THRESHOLD = 100
// Matches .variables-modal__row's natural rendered height (see styles.css)
// closely enough for react-virtual's absolute-positioned rows — rows have
// fixed padding/font-size and never wrap, so a static estimate is fine.
const ROW_HEIGHT = 34
// The divider row's own slot height in the virtualized list — see
// VariableRows' boundaryIndex/estimateSize for why this needs to be exact,
// not just a rough guess like ROW_HEIGHT above.
const DIVIDER_HEIGHT = 21
// Not a real EventSource id — the tab for variables with no mapping.
const CUSTOM_TAB = 'custom'
// How long a variable counts as "recently changed" for 'recent' sort mode,
// and the cadence of the countdown shown on the Recent button (see
// VariablesModal's countdown state below) — kept equal so "next re-check in
// Ns" and "how long a row stays pinned at the top" are the same number, not
// two cadences a user has to reconcile in their head.
const RECENT_WINDOW_MS = 5000

// Coerces a text input's raw value back into a VariableValue on blur/change
// — "true"/"false" become booleans, anything else numeric becomes a number,
// everything else stays a string. Lets you type a boolean or number without
// a separate type selector, while still round-tripping existing values
// (e.g. a number stays editable as digits, not quoted).
//
// Only converts when `raw` has NO leading/trailing whitespace — `Number()`
// itself silently trims before parsing (`Number('5 ') === 5`), which would
// otherwise strip a deliberately space-padded value (some DCS-BIOS string
// fields are fixed-width and padded with spaces on purpose) down to a bare
// number the instant you so much as blurred the field, even without editing
// it. A padded numeric-looking string like "5 " now stays the exact string
// it was.
function parseVariableValue(raw: string): VariableValue {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw !== '' && raw === raw.trim() && !Number.isNaN(Number(raw))) return Number(raw)
  return raw
}

// Memoized specifically so a fast-changing DCS-BIOS-mapped variable doesn't
// force every OTHER row to re-render too — applyVariableUpdates in
// main/index.ts already preserves object identity for variables that didn't
// change (a plain .map() that returns the same object reference when a
// variable's name isn't in that tick's updates), so a row whose own
// `variable` prop is reference-unchanged skips re-rendering entirely here.
// Requires onPatch/onRemove to be stable (useCallback'd in the parent) —
// otherwise every parent render would still bust this regardless.
const VariableRow = memo(function VariableRow({
  variable,
  mappedFrom,
  ignored,
  showIgnoreToggle,
  onPatch,
  onRemove,
  onToggleIgnore
}: {
  variable: Variable
  mappedFrom: string | undefined
  // Whether this variable is currently excluded from 'recent' sort's
  // "just changed" bucket — see onToggleIgnore's own comment below for what
  // this does and doesn't affect.
  ignored: boolean
  // Only 'recent' sort mode has any use for the ignore toggle at all — 'name'
  // sort doesn't look at recency, so showing it there would just be a button
  // that visibly does nothing.
  showIgnoreToggle: boolean
  onPatch: (id: string, fields: Partial<Variable>) => void
  onRemove: (id: string) => void
  // Toggles whether this variable's changes count toward 'recent' sort's
  // top-of-list bucket — purely a sort-order exclusion. The variable itself
  // still updates, still saves, still flashes green here same as any other
  // row; it just never gets bumped to the top for it. Meant for silencing a
  // noisy fast-changing variable (a clock, telemetry) while hunting for one
  // specific control's variable in a busy 'recent' list.
  onToggleIgnore: (id: string) => void
}): React.JSX.Element {
  const valueInputRef = useRef<HTMLInputElement>(null)
  // Seeded with the CURRENT value (not a mount-flag) specifically so this
  // survives React StrictMode's dev-mode double-invocation of effects on
  // mount — a boolean "have I mounted" ref would flip true on the first of
  // those two synchronous passes and incorrectly flash on the second, since
  // the ref itself isn't reset between them (same component instance, not a
  // real remount). Comparing actual values sidesteps that: both passes see
  // the same variable.value, so neither looks like a change.
  const lastValueRef = useRef(variable.value)

  // Pure CSS animation, restarted by toggling a class — no setTimeout/
  // setInterval to clean up, so nothing accumulates no matter how fast
  // `variable.value` changes. Forcing a reflow (`offsetWidth`) between
  // remove and re-add is what makes the browser treat back-to-back changes
  // as a fresh animation each time, instead of the second one being a no-op
  // because the class was "already set." Scoped to just the value box, not
  // the whole row.
  useEffect(() => {
    if (lastValueRef.current === variable.value) return
    lastValueRef.current = variable.value
    const el = valueInputRef.current
    if (!el) return
    el.classList.remove('variables-modal__row--flash')
    void el.offsetWidth
    el.classList.add('variables-modal__row--flash')
  }, [variable.value])

  return (
    <div className={`variables-modal__row${showIgnoreToggle ? ' variables-modal__row--with-ignore' : ''}${ignored ? ' variables-modal__row--ignored' : ''}`}>
      <input
        value={variable.name}
        // readOnly, not disabled — a disabled input can't be focused at all,
        // so its text can't be selected/copied either. readOnly blocks
        // edits the same way but leaves it copyable.
        readOnly={!!mappedFrom}
        title={mappedFrom ? `Mapped from event source "${mappedFrom}" — rename it there instead` : undefined}
        onChange={(e) => onPatch(variable.id, { name: e.target.value })}
      />
      <input
        ref={valueInputRef}
        defaultValue={String(variable.value)}
        key={`${variable.id}-${String(variable.value)}`}
        onBlur={(e) => onPatch(variable.id, { value: parseVariableValue(e.target.value) })}
      />
      {showIgnoreToggle && (
        <button
          type="button"
          className={`variables-modal__ignore${ignored ? ' variables-modal__ignore--active' : ''}`}
          title={
            ignored
              ? 'Ignored for Recent sort — this variable’s changes no longer bump it to the top. Value updates normally.'
              : 'Ignore for Recent sort — silences this variable’s changes for sorting only, so it stops jumping to the top'
          }
          onClick={() => onToggleIgnore(variable.id)}
        >
          ⊘
        </button>
      )}
      <button
        type="button"
        className="variables-modal__remove"
        // Deleting it here wouldn't stick anyway — the mapping would just
        // recreate it under the same name on its next tick. Remove the
        // mapping itself (Events, in the toolbar) to actually get rid of it.
        disabled={!!mappedFrom}
        title={mappedFrom ? `Mapped from event source "${mappedFrom}" — remove the mapping there instead` : 'Delete variable'}
        onClick={() => onRemove(variable.id)}
      >
        ×
      </button>
    </div>
  )
})

// Plain or virtualized row list — a tab now corresponds to exactly one
// event source instance (or the Custom bucket), so there's no further
// sub-grouping needed within a tab.
function VariableRows({
  variables,
  mappedFromSource,
  ignoredIds,
  showIgnoreToggle,
  recentIds,
  onPatch,
  onRemove,
  onToggleIgnore
}: {
  variables: Variable[]
  mappedFromSource: Map<string, { sourceId: string; sourceName: string }>
  ignoredIds: Set<string>
  showIgnoreToggle: boolean
  // null outside 'recent' sort mode — when set, everything in `variables` up
  // to (not including) boundaryIndex below is a member, since VariablesModal
  // already sorted recent-first. Passed down (rather than recomputed here)
  // so this stays the single source of truth both the sort order and this
  // divider agree on.
  recentIds: Set<string> | null
  onPatch: (id: string, fields: Partial<Variable>) => void
  onRemove: (id: string) => void
  onToggleIgnore: (id: string) => void
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualize = variables.length > VIRTUALIZE_THRESHOLD

  // Index of the first NOT-recent variable — where the divider goes. undefined
  // when there's nothing to separate: 'recent' isn't active, or every/no
  // variable currently qualifies (a divider at position 0 or at the very end
  // wouldn't actually separate anything).
  const boundaryIndex = useMemo(() => {
    if (!recentIds) return undefined
    let count = 0
    for (const v of variables) {
      if (!recentIds.has(v.id)) break
      count++
    }
    return count > 0 && count < variables.length ? count : undefined
  }, [variables, recentIds])

  // One extra virtual slot for the divider, inserted at boundaryIndex — the
  // divider's own slot gets DIVIDER_HEIGHT instead of ROW_HEIGHT so the
  // virtualizer's positions stay pixel-accurate around it (react-virtual has
  // no dynamic measurement wired up here, so estimateSize IS the real size
  // used for every row's translateY, not just a first guess).
  const virtualizer = useVirtualizer({
    count: variables.length + (boundaryIndex !== undefined ? 1 : 0),
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (boundaryIndex !== undefined && index === boundaryIndex ? DIVIDER_HEIGHT : ROW_HEIGHT),
    overscan: 8
  })

  // react-virtual only fully recomputes row positions when `count` (or a
  // couple other tracked options) changes — it has no way to know
  // `estimateSize`'s OUTPUT for a given index also depends on boundaryIndex.
  // When the boundary merely moves (a different variable becomes "most
  // recently changed," same total split into two groups either side), count
  // stays identical, so it silently reuses stale cached positions from the
  // old boundary location while the row *content* re-renders at the new
  // one — the divider's slot height falls out of sync with what's actually
  // drawn there, and everything after it visually overlaps. measure() is
  // react-virtual's documented escape hatch for an externally-driven size
  // change it can't detect on its own.
  useEffect(() => {
    virtualizer.measure()
  }, [boundaryIndex, virtualizer])

  if (virtualize) {
    return (
      <div ref={scrollRef} className="variables-modal__group-scroll">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const wrapperStyle: React.CSSProperties = {
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: item.size,
              transform: `translateY(${item.start}px)`
            }
            if (boundaryIndex !== undefined && item.index === boundaryIndex) {
              return (
                <div key="recent-boundary" style={wrapperStyle}>
                  <div className="variables-modal__recent-divider" />
                </div>
              )
            }
            // Every index past the inserted divider slot is shifted by one
            // relative to the real `variables` array.
            const variableIndex = boundaryIndex !== undefined && item.index > boundaryIndex ? item.index - 1 : item.index
            const variable = variables[variableIndex]
            return (
              <div key={variable.id} style={wrapperStyle}>
                <VariableRow
                  variable={variable}
                  mappedFrom={mappedFromSource.get(variable.name)?.sourceName}
                  ignored={ignoredIds.has(variable.id)}
                  showIgnoreToggle={showIgnoreToggle}
                  onPatch={onPatch}
                  onRemove={onRemove}
                  onToggleIgnore={onToggleIgnore}
                />
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  const rows: React.ReactNode[] = []
  variables.forEach((variable, index) => {
    if (boundaryIndex === index) rows.push(<div key="recent-boundary" className="variables-modal__recent-divider" />)
    rows.push(
      <VariableRow
        key={variable.id}
        variable={variable}
        mappedFrom={mappedFromSource.get(variable.name)?.sourceName}
        ignored={ignoredIds.has(variable.id)}
        showIgnoreToggle={showIgnoreToggle}
        onPatch={onPatch}
        onRemove={onRemove}
        onToggleIgnore={onToggleIgnore}
      />
    )
  })

  return <div className="variables-modal__list">{rows}</div>
}

export function VariablesModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const variables = useDashboardStore((s) => s.dashboard.variables) ?? []
  const eventSources = useDashboardStore((s) => s.dashboard.eventSources) ?? []
  const updateDashboardMeta = useDashboardStore((s) => s.updateDashboardMeta)
  useEscapeToClose(onClose)

  const [search, setSearch] = useState(() => getVariablesFilter().search)
  const [activeTab, setActiveTab] = useState<string>(() => getVariablesFilter().tab || CUSTOM_TAB)
  const [sortMode, setSortMode] = useState<'name' | 'recent'>(() => getVariablesFilter().sort)

  // Persisted as one blob so reopening the modal lands back where you left
  // it — see getVariablesFilter's own comment in id.ts for why (the modal is
  // unmounted on close, so component state alone doesn't survive that).
  useEffect(() => {
    setVariablesFilter({ search, tab: activeTab, sort: sortMode })
  }, [search, activeTab, sortMode])

  // When each variable last actually changed value (or first appeared) —
  // keyed by id, not touched for a variable whose value didn't change.
  // Compares actual values, not object identity — applyVariableUpdates in
  // main/index.ts does preserve object identity for a variable a tick didn't
  // touch, but that's server-side only; store.ts's 'variables:sync' handler
  // gets there via JSON.parse(event.data), which mints a brand-new object
  // for every variable on every sync regardless of whether its value
  // changed. An identity check here would mark the WHOLE list "just
  // changed" the instant a single DCS-BIOS field ticked, which is
  // indistinguishable from plain name sort — exactly the bug this replaced.
  const lastChangedAtRef = useRef<Map<string, number>>(new Map())
  const prevVariablesRef = useRef<Variable[]>(variables)
  if (prevVariablesRef.current !== variables) {
    const prevById = new Map(prevVariablesRef.current.map((v) => [v.id, v]))
    const now = Date.now()
    for (const v of variables) {
      const prev = prevById.get(v.id)
      if (!prev || prev.value !== v.value) lastChangedAtRef.current.set(v.id, now)
    }
    prevVariablesRef.current = variables
  }

  // `recentIds` — see its own comment further down — is deliberately NOT
  // recomputed on every `variables` change, only on this timer (plus a
  // couple of direct user actions below). These refs let the interval below
  // always read the LATEST variables/ignoredIds without needing them in its
  // dependency array — listing them there would tear down and restart the
  // interval (and reset the visible countdown) on literally every DCS-BIOS
  // packet, which defeats the whole point.
  const variablesRef = useRef(variables)
  variablesRef.current = variables
  const ignoredIdsRef = useRef<Set<string>>(new Set())

  const [recentIds, setRecentIds] = useState<Set<string> | null>(null)
  const recomputeRecentIds = useCallback((): void => {
    const now = Date.now()
    const set = new Set<string>()
    for (const v of variablesRef.current) {
      if (!ignoredIdsRef.current.has(v.id) && now - (lastChangedAtRef.current.get(v.id) ?? 0) < RECENT_WINDOW_MS) set.add(v.id)
    }
    setRecentIds(set)
  }, [])

  // `countdown` doubles as the recompute trigger AND the number shown on the
  // Recent button: ticks down once a second, and only actually recomputes
  // (resetting back to the full window) once it hits zero — so a background
  // field simply changing value can't jump the queue and re-sort early; only
  // this timer (or a direct ignore/un-ignore below) does.
  const [countdown, setCountdown] = useState(RECENT_WINDOW_MS / 1000)
  useEffect(() => {
    if (sortMode !== 'recent') {
      setRecentIds(null)
      return
    }
    recomputeRecentIds()
    setCountdown(RECENT_WINDOW_MS / 1000)
    const interval = setInterval(() => {
      setCountdown((s) => {
        if (s > 1) return s - 1
        recomputeRecentIds()
        return RECENT_WINDOW_MS / 1000
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [sortMode, recomputeRecentIds])

  // Variables excluded from 'recent' sort's "just changed" bucket — see
  // VariableRow's onToggleIgnore prop comment for exactly what this does and
  // doesn't affect. Persisted the same way as search/tab/sort above (the
  // modal fully unmounts on close, see getVariablesFilter's own comment in
  // id.ts) since a silenced-forever "clock" or telemetry variable is meant to
  // stay silenced across reopening the modal, not just for the rest of this
  // session.
  const [ignoredIds, setIgnoredIds] = useState<Set<string>>(() => new Set(getIgnoredVariableIds()))
  ignoredIdsRef.current = ignoredIds
  useEffect(() => {
    setIgnoredVariableIds([...ignoredIds])
  }, [ignoredIds])
  const toggleIgnored = useCallback((id: string): void => {
    setIgnoredIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Ignoring/un-ignoring is a direct action — reflect it immediately rather
  // than waiting for the next countdown tick (this effect runs after
  // ignoredIdsRef.current above has already been synced to the new value, so
  // recomputeRecentIds sees it correctly).
  useEffect(() => {
    if (sortMode === 'recent') recomputeRecentIds()
  }, [ignoredIds, sortMode, recomputeRecentIds])

  // Renaming/removing a variable here wouldn't affect the event source
  // mapping that targets it by name — the mapping would just keep
  // recreating a variable under the old name next tick. Rename/remove it
  // from the mapping itself (Events, in the toolbar) instead.
  const mappedFromSource = useMemo(() => {
    const map = new Map<string, { sourceId: string; sourceName: string }>()
    for (const source of eventSources) {
      for (const mapping of source.mappings) {
        const name = mapping.variableName.trim()
        if (name && !map.has(name)) map.set(name, { sourceId: source.id, sourceName: source.name })
      }
    }
    return map
  }, [eventSources])

  // One tab per event source INSTANCE with at least one mapping — not per
  // kind, so two separate DCS-BIOS sources (e.g. one per aircraft) each get
  // their own tab rather than being bundled together.
  const sourceTabs = useMemo(() => eventSources.filter((s) => s.mappings.length > 0), [eventSources])

  const tabs = useMemo(() => {
    const counts = new Map<string, number>()
    for (const v of variables) {
      const mapped = mappedFromSource.get(v.name)
      counts.set(mapped ? mapped.sourceId : CUSTOM_TAB, (counts.get(mapped ? mapped.sourceId : CUSTOM_TAB) ?? 0) + 1)
    }
    return [
      { id: CUSTOM_TAB, label: 'Custom', count: counts.get(CUSTOM_TAB) ?? 0 },
      ...sourceTabs.map((s) => ({ id: s.id, label: s.name, count: counts.get(s.id) ?? 0 }))
    ]
  }, [sourceTabs, variables, mappedFromSource])

  // Falls back to Custom if the active tab's source was removed (or its
  // last mapping was).
  useEffect(() => {
    if (activeTab === CUSTOM_TAB) return
    if (!sourceTabs.some((s) => s.id === activeTab)) setActiveTab(CUSTOM_TAB)
  }, [activeTab, sourceTabs])

  const tabVariables = useMemo(() => {
    const inTab =
      activeTab === CUSTOM_TAB
        ? variables.filter((v) => !mappedFromSource.has(v.name))
        : variables.filter((v) => mappedFromSource.get(v.name)?.sourceId === activeTab)
    if (!recentIds) return [...inTab].sort((a, b) => a.name.localeCompare(b.name))
    return [...inTab].sort((a, b) => {
      const recentDelta = Number(recentIds.has(b.id)) - Number(recentIds.has(a.id))
      return recentDelta !== 0 ? recentDelta : a.name.localeCompare(b.name)
    })
  }, [variables, mappedFromSource, activeTab, recentIds])

  const filtered = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (words.length === 0) return tabVariables
    return tabVariables.filter((v) => {
      const haystack = `${v.name.toLowerCase()} ${String(v.value).toLowerCase()}`
      return words.every((word) => haystack.includes(word))
    })
  }, [tabVariables, search])

  // useCallback'd specifically so VariableRow's React.memo (see above) can
  // actually skip re-rendering unchanged rows — a fresh function identity on
  // every render would otherwise bust that memoization regardless of
  // whether a row's own variable changed.
  const patchVariable = useCallback(
    (id: string, fields: Partial<Variable>): void => {
      updateDashboardMeta({ variables: variables.map((v) => (v.id === id ? { ...v, ...fields } : v)) })
    },
    [variables, updateDashboardMeta]
  )

  const removeVariable = useCallback(
    (id: string): void => {
      updateDashboardMeta({ variables: variables.filter((v) => v.id !== id) })
    },
    [variables, updateDashboardMeta]
  )

  function addVariable(): void {
    // Dashboard-wide uniqueness — a manual variable colliding with an
    // existing mapped (or other manual) variable's name would just silently
    // share/overwrite it in applyVariableUpdates, not create a new one.
    const taken = new Set(variables.map((v) => v.name))
    const name = uniqueVariableName('new_variable', taken)
    updateDashboardMeta({ variables: [...variables, { id: nextId(), name, value: '' }] })
  }

  return (
    <div className="variables-modal-overlay" onPointerDown={onClose}>
      <div className="variables-modal" onPointerDown={(e) => e.stopPropagation()}>
        <div className="variables-modal__header">
          <h2 className="variables-modal__title">Variables</h2>
          <button type="button" className="modal-close" title="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="variables-modal__body">
          <p className="properties__hint">
            Referenced in expressions as <code>variables.&lt;name&gt;</code>. Set by any widget whose action is "Update
            state", or by an event source's mapping (see "Events" in the toolbar).
          </p>

          {variables.length === 0 && <p className="properties__hint">No variables yet.</p>}

          {variables.length > 0 && (
            <>
              <div className="variables-modal__tabs">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className={`variables-modal__tab${activeTab === tab.id ? ' variables-modal__tab--active' : ''}`}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    {tab.label}
                    <span className="variables-modal__group-count">{tab.count}</span>
                  </button>
                ))}
              </div>

              <div className="variables-modal__toolbar">
                <input
                  className="variables-modal__search"
                  type="text"
                  placeholder="Search variables…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="variables-modal__sort-toggle">
                  <span className="variables-modal__sort-label">Sort:</span>
                  <button
                    type="button"
                    className={`variables-modal__sort-btn${sortMode === 'recent' ? ' variables-modal__sort-btn--active' : ''}`}
                    title={`Pin recently-changed variables to the top, re-checked every ${RECENT_WINDOW_MS / 1000} seconds`}
                    onClick={() => setSortMode('recent')}
                  >
                    Recent{sortMode === 'recent' ? ` (${countdown}s)` : ''}
                  </button>
                  <button
                    type="button"
                    className={`variables-modal__sort-btn${sortMode === 'name' ? ' variables-modal__sort-btn--active' : ''}`}
                    title="Sort alphabetically by name"
                    onClick={() => setSortMode('name')}
                  >
                    Name
                  </button>
                  {sortMode === 'recent' && (
                    <button
                      type="button"
                      className="variables-modal__sort-btn"
                      disabled={ignoredIds.size === 0}
                      title="Stop ignoring every variable currently silenced for Recent sort"
                      onClick={() => setIgnoredIds(new Set())}
                    >
                      Clear ignores{ignoredIds.size > 0 ? ` (${ignoredIds.size})` : ''}
                    </button>
                  )}
                </div>
              </div>

              <div className="variables-modal__scroll">
                {tabVariables.length === 0 && <p className="properties__hint">No variables in this category yet.</p>}
                {tabVariables.length > 0 && filtered.length === 0 && (
                  <p className="properties__hint">No variables match &quot;{search}&quot;.</p>
                )}

                {filtered.length > 0 && (
                  <div className="variables-modal__groups">
                    <VariableRows
                      variables={filtered}
                      mappedFromSource={mappedFromSource}
                      ignoredIds={ignoredIds}
                      showIgnoreToggle={sortMode === 'recent'}
                      recentIds={recentIds}
                      onPatch={patchVariable}
                      onRemove={removeVariable}
                      onToggleIgnore={toggleIgnored}
                    />
                  </div>
                )}
              </div>
            </>
          )}

          <div className="variables-modal__actions">
            <button type="button" className="properties__file-button" onClick={addVariable}>
              + Add variable
            </button>
            <button type="button" className="device-modal__save" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
