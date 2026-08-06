import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useDashboardStore } from '../store'
import { nextId } from '../id'
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
// Not a real EventSource id — the tab for variables with no mapping.
const CUSTOM_TAB = 'custom'

// Coerces a text input's raw value back into a VariableValue on blur/change
// — "true"/"false" become booleans, anything else numeric becomes a number,
// everything else stays a string. Lets you type a boolean or number without
// a separate type selector, while still round-tripping existing values
// (e.g. a number stays editable as digits, not quoted).
function parseVariableValue(raw: string): VariableValue {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw.trim() !== '' && !Number.isNaN(Number(raw))) return Number(raw)
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
  onPatch,
  onRemove
}: {
  variable: Variable
  mappedFrom: string | undefined
  onPatch: (id: string, fields: Partial<Variable>) => void
  onRemove: (id: string) => void
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
    <div className="variables-modal__row">
      <input
        value={variable.name}
        disabled={!!mappedFrom}
        title={mappedFrom ? `Mapped from event source "${mappedFrom}" — rename it there instead` : undefined}
        onChange={(e) => onPatch(variable.id, { name: e.target.value })}
      />
      <input
        ref={valueInputRef}
        defaultValue={String(variable.value)}
        key={`${variable.id}-${String(variable.value)}`}
        onBlur={(e) => onPatch(variable.id, { value: parseVariableValue(e.target.value) })}
      />
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
  onPatch,
  onRemove
}: {
  variables: Variable[]
  mappedFromSource: Map<string, { sourceId: string; sourceName: string }>
  onPatch: (id: string, fields: Partial<Variable>) => void
  onRemove: (id: string) => void
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualize = variables.length > VIRTUALIZE_THRESHOLD
  const virtualizer = useVirtualizer({
    count: variables.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8
  })

  if (virtualize) {
    return (
      <div ref={scrollRef} className="variables-modal__group-scroll">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const variable = variables[item.index]
            return (
              <div
                key={variable.id}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: item.size, transform: `translateY(${item.start}px)` }}
              >
                <VariableRow variable={variable} mappedFrom={mappedFromSource.get(variable.name)?.sourceName} onPatch={onPatch} onRemove={onRemove} />
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="variables-modal__list">
      {variables.map((variable) => (
        <VariableRow key={variable.id} variable={variable} mappedFrom={mappedFromSource.get(variable.name)?.sourceName} onPatch={onPatch} onRemove={onRemove} />
      ))}
    </div>
  )
}

export function VariablesModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const variables = useDashboardStore((s) => s.dashboard.variables) ?? []
  const eventSources = useDashboardStore((s) => s.dashboard.eventSources) ?? []
  const updateDashboardMeta = useDashboardStore((s) => s.updateDashboardMeta)
  useEscapeToClose(onClose)

  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<string>(CUSTOM_TAB)

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
    if (activeTab === CUSTOM_TAB) return variables.filter((v) => !mappedFromSource.has(v.name))
    return variables.filter((v) => mappedFromSource.get(v.name)?.sourceId === activeTab)
  }, [variables, mappedFromSource, activeTab])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return tabVariables
    return tabVariables.filter((v) => v.name.toLowerCase().includes(needle) || String(v.value).toLowerCase().includes(needle))
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
        <h2 className="variables-modal__title">Variables</h2>
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
            </div>

            {tabVariables.length === 0 && <p className="properties__hint">No variables in this category yet.</p>}
            {tabVariables.length > 0 && filtered.length === 0 && (
              <p className="properties__hint">No variables match &quot;{search}&quot;.</p>
            )}

            {filtered.length > 0 && (
              <div className="variables-modal__groups">
                <VariableRows variables={filtered} mappedFromSource={mappedFromSource} onPatch={patchVariable} onRemove={removeVariable} />
              </div>
            )}
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
  )
}
