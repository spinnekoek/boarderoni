import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useDashboardStore, type DcsBiosFieldCatalogState } from '../store'
import { useEditorSettings } from '../settingsStore'
import { nextId } from '../id'
import { useEscapeToClose } from '../useEscapeToClose'
import { uniqueVariableName } from '../variableNaming'
import { CodeEditor } from './CodeEditor'
import { ExpressionEditorModal } from './ExpressionEditorModal'
import { EVENT_SOURCE_TYPES, getEventSourceType, type EventSourceTypeMeta } from '@shared/eventSources'
import type { EventSource, EventSourceMapping, ScreenRegion } from '@shared/types'
import type { DcsBiosFieldCatalogEntry } from '@shared/dcsBiosTypes'

// Kept to a single line deliberately — CodeMirror's placeholder extension
// renders an embedded "\n" as an actual second visual row, so the empty
// editor would render two rows tall and then visibly shrink to one the
// moment real (single-line) text replaces the placeholder.
const EXPR_PLACEHOLDER = 'return variables.$value;'

const MIN_UPDATE_HZ = 1
const MAX_UPDATE_HZ = 25
const DEFAULT_UPDATE_HZ = 10
const FIELD_VIRTUALIZE_THRESHOLD = 100
const FIELD_ROW_HEIGHT = 40

// Matches the clamp range in main/eventSourceProducers.ts's ocrRegion
// producer — kept in sync manually since one's a renderer-side slider and
// the other's the main-process tick scheduler, with no shared module
// between them for a single small numeric range.
const MIN_OCR_INTERVAL_MS = 200
const MAX_OCR_INTERVAL_MS = 5000
const DEFAULT_OCR_INTERVAL_MS = 1000

// Matches DCS-BIOS's own identifier casing (ALL_CAPS_WITH_UNDERSCORES) —
// its field keys are already exactly this shape, so this is a no-op for the
// vast majority of fields and only actually transforms a suffix-qualified
// key like "SOME_ID.SUFFIX" into "SOME_ID_SUFFIX".
function deriveVariableName(key: string): string {
  const cleaned = key
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return cleaned || 'FIELD'
}

// DCS-BIOS's docs don't actually carry labeled value meanings in practice
// (checked against a real ~50-aircraft docs folder — a `positions`-style
// field was never populated), so this is only ever a numeric range/length,
// not per-value labels.
function fieldValueHint(entry: DcsBiosFieldCatalogEntry): string {
  if (entry.valueType === 'integer') return `0–${entry.maxValue ?? 65535}`
  return `text, ≤${entry.maxLength ?? 0} chars`
}

function groupByCategory(entries: DcsBiosFieldCatalogEntry[]): { category: string; entries: DcsBiosFieldCatalogEntry[] }[] {
  const byCategory = new Map<string, DcsBiosFieldCatalogEntry[]>()
  for (const entry of entries) {
    const list = byCategory.get(entry.category)
    if (list) list.push(entry)
    else byCategory.set(entry.category, [entry])
  }
  return Array.from(byCategory, ([category, categoryEntries]) => ({ category, entries: categoryEntries })).sort((a, b) =>
    a.category.localeCompare(b.category)
  )
}

// One mapping row. Its own component (rather than inline in the .map() below)
// specifically so it can hold its own expr-panel/expand state — same fx →
// inline panel → expand-to-modal interaction as ColorPickerButton.tsx, reused
// here via the same CSS classes (color-picker-button__fx/clear/expr-panel/
// expand). With no expr set, the field's raw value is mapped straight into
// the variable; fx opts into transforming it first.
function MappingRow({
  mapping,
  typeMeta,
  fieldLabel,
  onPatch,
  onRemove
}: {
  mapping: EventSourceMapping
  typeMeta: EventSourceTypeMeta | undefined
  // Only meaningful for a dynamicFields kind — the field's human label
  // looked up from its cached catalog, if loaded. Falls back to the raw
  // field key when the catalog isn't available (e.g. right after reload,
  // before this source's aircraft catalog has been re-fetched).
  fieldLabel?: string
  onPatch: (fields: Partial<EventSourceMapping>) => void
  onRemove: () => void
}): React.JSX.Element {
  const isExpr = mapping.expr !== undefined
  const [expanded, setExpanded] = useState(false)

  // Remembers the last non-empty expression text across on/off toggles — the
  // × button below clears `expr` to undefined, which would otherwise lose
  // whatever was typed the moment fx is turned off. Same pattern as
  // ColorPickerButton.tsx's own draftRef, for the same reason.
  const draftRef = useRef(mapping.expr ?? '')
  useEffect(() => {
    if (mapping.expr) draftRef.current = mapping.expr
  }, [mapping.expr])

  return (
    <div className="events-modal__mapping">
      <div className="events-modal__mapping-row">
        {typeMeta?.dynamicFields ? (
          <span className="events-modal__mapping-field-label" title={mapping.field}>
            {fieldLabel ?? mapping.field}
          </span>
        ) : (
          <select value={mapping.field} onChange={(e) => onPatch({ field: e.target.value })}>
            {typeMeta?.fields.map((field) => (
              <option key={field.key} value={field.key}>
                {field.label}
              </option>
            ))}
          </select>
        )}
        <span className="events-modal__mapping-arrow">→</span>
        <input
          className="events-modal__mapping-variable"
          // Uncontrolled + committed on blur, not onChange — the producer
          // tick (every ~1s) reads mapping.variableName straight off
          // room.dashboard and creates whatever variable that names, so a
          // live onChange would create a fresh, real Variable for every
          // partial name typed along the way (see main/index.ts's
          // syncEventSources). Same pattern VariablesModal's own Value field
          // already uses, for the same reason.
          defaultValue={mapping.variableName}
          key={`${mapping.id}-${mapping.variableName}`}
          placeholder="variable name"
          onBlur={(e) => onPatch({ variableName: e.target.value })}
        />
        {isExpr ? (
          <button
            type="button"
            className="color-picker-button__clear"
            title="Map the raw value directly instead"
            onClick={() => onPatch({ expr: undefined })}
          >
            ×
          </button>
        ) : (
          <button
            type="button"
            className="color-picker-button__fx"
            title="Transform the value with an expression"
            onClick={() => onPatch({ expr: draftRef.current })}
          >
            ƒx
          </button>
        )}
        <button type="button" className="variables-modal__remove" title="Delete mapping" onClick={onRemove}>
          ×
        </button>
      </div>

      {isExpr && (
        <div className="color-picker-button__expr-panel">
          <div className="color-picker-button__expr-editor-wrap">
            <CodeEditor value={mapping.expr ?? ''} onChange={(code) => onPatch({ expr: code })} placeholder={EXPR_PLACEHOLDER} minimal />
            <button type="button" className="color-picker-button__expand" title="Expand" onClick={() => setExpanded(true)}>
              ⤢
            </button>
          </div>
        </div>
      )}

      {expanded && (
        <ExpressionEditorModal
          value={mapping.expr ?? ''}
          onChange={(code) => onPatch({ expr: code })}
          placeholder={EXPR_PLACEHOLDER}
          onClose={() => setExpanded(false)}
        />
      )}
    </div>
  )
}

function DcsBiosFieldRow({
  entry,
  checked,
  onToggle
}: {
  entry: DcsBiosFieldCatalogEntry
  checked: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <label className="events-modal__field-row">
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span className="events-modal__field-label" title={entry.label}>
        {entry.label}
      </span>
      <span className="events-modal__field-key">{entry.key}</span>
      <span className="events-modal__field-hint">{fieldValueHint(entry)}</span>
    </label>
  )
}

function DcsBiosFieldCategoryGroup({
  category,
  entries,
  checkedKeys,
  onToggle,
  defaultOpen
}: {
  category: string
  entries: DcsBiosFieldCatalogEntry[]
  checkedKeys: Set<string>
  onToggle: (key: string) => void
  defaultOpen: boolean
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualize = entries.length > FIELD_VIRTUALIZE_THRESHOLD
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => FIELD_ROW_HEIGHT,
    overscan: 8
  })

  return (
    <details className="events-modal__field-category" open={defaultOpen}>
      <summary>
        <span>{category}</span>
        <span className="variables-modal__group-count">{entries.length}</span>
      </summary>
      {virtualize ? (
        <div ref={scrollRef} className="events-modal__field-scroll">
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => {
              const entry = entries[item.index]
              return (
                <div
                  key={entry.key}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: item.size, transform: `translateY(${item.start}px)` }}
                >
                  <DcsBiosFieldRow entry={entry} checked={checkedKeys.has(entry.key)} onToggle={() => onToggle(entry.key)} />
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="events-modal__field-list">
          {entries.map((entry) => (
            <DcsBiosFieldRow key={entry.key} entry={entry} checked={checkedKeys.has(entry.key)} onToggle={() => onToggle(entry.key)} />
          ))}
        </div>
      )}
    </details>
  )
}

// Opened from a source's "Add mapping(s)" button. Search + category
// grouping keeps a several-hundred-field aircraft navigable; checkbox
// multi-select + one "Add N mappings" call means mapping a batch of fields
// doesn't mean repeating add-mapping → pick-field once per field.
function DcsBiosFieldBrowser({
  catalogState,
  existingVariableNames,
  onClose,
  onAdd
}: {
  catalogState: DcsBiosFieldCatalogState | undefined
  existingVariableNames: Set<string>
  onClose: () => void
  onAdd: (mappings: EventSourceMapping[]) => void
}): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [checked, setChecked] = useState<Set<string>>(new Set())

  const entries = useMemo(() => (Array.isArray(catalogState) ? catalogState : []), [catalogState])
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return entries
    return entries.filter(
      (e) => e.label.toLowerCase().includes(needle) || e.key.toLowerCase().includes(needle) || e.category.toLowerCase().includes(needle)
    )
  }, [entries, search])
  const groups = useMemo(() => groupByCategory(filtered), [filtered])
  const hasSearch = search.trim().length > 0

  function toggle(key: string): void {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function handleAdd(): void {
    const taken = new Set(existingVariableNames)
    const mappings: EventSourceMapping[] = []
    for (const entry of entries) {
      if (!checked.has(entry.key)) continue
      const name = uniqueVariableName(deriveVariableName(entry.key), taken)
      taken.add(name)
      mappings.push({ id: nextId(), field: entry.key, variableName: name })
    }
    onAdd(mappings)
  }

  return (
    <div className="events-modal__field-browser">
      {catalogState === undefined || catalogState === 'loading' ? (
        <p className="properties__hint">Loading fields…</p>
      ) : !Array.isArray(catalogState) ? (
        <p className="properties__hint dcsbios-settings__error">Failed to load fields: {catalogState.error}</p>
      ) : (
        <>
          <input
            className="variables-modal__search"
            type="text"
            placeholder={`Search ${entries.length} fields…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="events-modal__field-groups">
            {groups.map((group) => (
              <DcsBiosFieldCategoryGroup
                key={group.category}
                category={group.category}
                entries={group.entries}
                checkedKeys={checked}
                onToggle={toggle}
                defaultOpen={hasSearch}
              />
            ))}
            {groups.length === 0 && <p className="properties__hint">No fields match &quot;{search}&quot;.</p>}
          </div>
          <div className="events-modal__field-browser-footer">
            <button type="button" className="properties__file-button" disabled={checked.size === 0} onClick={handleAdd}>
              Add {checked.size > 0 ? checked.size : ''} mapping{checked.size === 1 ? '' : 's'}
            </button>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function DcsBiosStatusBanner({ onConfigure }: { onConfigure: () => void }): React.JSX.Element {
  const status = useDashboardStore((s) => s.dcsBiosStatus)
  const stats = useDashboardStore((s) => s.dcsBiosStats)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  // Self-scaling rather than pinned to an arbitrary absolute ceiling, which
  // would make typical traffic look either empty or permanently maxed out.
  const maxWritesSeenRef = useRef(1)
  if (stats) maxWritesSeenRef.current = Math.max(maxWritesSeenRef.current, stats.writesPerSec)

  let message: string
  if (!status || !status.everConnected) {
    message = 'DCS-BIOS: no data received yet — check DCS is running with DCS-BIOS installed and export enabled.'
  } else if (!status.connected) {
    message = 'DCS-BIOS: connection lost — is DCS still running?'
  } else if (status.activeAircraft) {
    message = `DCS-BIOS: connected — flying ${status.activeAircraft}`
  } else {
    message = 'DCS-BIOS: connected, no aircraft loaded'
  }

  const barPct = stats ? Math.min(100, Math.round((stats.writesPerSec / maxWritesSeenRef.current) * 100)) : 0
  const laggy = stats ? stats.eventLoopDelayMeanMs > 20 : false

  return (
    <div className="events-modal__dcsbios-status">
      <div className="events-modal__dcsbios-status-row">
        <span className={`app__status app__status--${status?.connected ? 'on' : 'off'}`}>{status?.connected ? 'online' : 'offline'}</span>
        <span>{message}</span>
        <button type="button" className="events-modal__configure-link" onClick={onConfigure}>
          Configure in Settings
        </button>
      </div>
      <button type="button" className="events-modal__diagnostics-toggle" onClick={() => setDiagnosticsOpen((o) => !o)}>
        {diagnosticsOpen ? 'Hide diagnostics' : 'Show diagnostics'}
      </button>
      {diagnosticsOpen && (
        <div className="events-modal__diagnostics">
          <p className="properties__hint-inline">Reflects DCS-BIOS's own output rate — not affected by any source's update-frequency slider below.</p>
          <div className="events-modal__diagnostics-bar-track">
            <div className="events-modal__diagnostics-bar-fill" style={{ width: `${barPct}%` }} />
          </div>
          <div className="events-modal__diagnostics-numbers">
            <span>{stats ? stats.packetsPerSec.toFixed(1) : '0.0'} packets/sec</span>
            <span>{stats ? stats.writesPerSec.toFixed(1) : '0.0'} writes/sec</span>
            <span className={laggy ? 'dcsbios-settings__error' : undefined}>
              event loop delay: {stats ? stats.eventLoopDelayMeanMs.toFixed(1) : '0.0'}ms avg / {stats ? stats.eventLoopDelayMaxMs.toFixed(1) : '0.0'}ms max
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// Mirrors VariablesModal.tsx's structure: overlay/panel, mutates only
// through updateDashboardMeta (no dedicated store actions), no new WS
// message types needed since a full dashboard:update already round-trips
// (the DCS-BIOS-specific WS messages this modal also uses — aircraft list,
// field catalogs, status/stats — are separate, handled via the store's own
// request actions/message branches, see store.ts).
export function EventsModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  // Selected specifically (not the whole dashboard) — once a source is
  // ticking, dashboard:sync arrives about once a second, but a
  // variables-only tick leaves this array's reference untouched (see
  // applyVariableUpdates in main/index.ts), so this selector naturally never
  // re-renders while someone's mid-edit here. Widening this to `s.dashboard`
  // would thrash the UI (and fight CodeEditor's cursor-preserving update
  // effect) every second.
  const eventSources = useDashboardStore((s) => s.dashboard.eventSources) ?? []
  const variables = useDashboardStore((s) => s.dashboard.variables) ?? []
  const updateDashboardMeta = useDashboardStore((s) => s.updateDashboardMeta)
  const [addPickerOpen, setAddPickerOpen] = useState(false)
  const [browserOpenForSourceId, setBrowserOpenForSourceId] = useState<string | null>(null)
  // Lives in useEditorSettings, not local state — see that field's own
  // comment for why (this modal fully unmounts on close).
  const activeSourceId = useEditorSettings((s) => s.eventsModalActiveSourceId)
  const setActiveSourceId = useEditorSettings((s) => s.setEventsModalActiveSourceId)
  useEscapeToClose(onClose)

  // Falls back to the first remaining source if the active tab's source was
  // removed (or defaults to the first source on initial load).
  useEffect(() => {
    if (eventSources.length === 0) {
      setActiveSourceId(null)
      return
    }
    if (!eventSources.some((s) => s.id === activeSourceId)) setActiveSourceId(eventSources[0].id)
  }, [eventSources, activeSourceId])

  // Dashboard-wide, not per-source — a new mapping's auto-generated name
  // must avoid colliding with ANY existing variable (another source's
  // mapping, or a manual one), not just this source's own mappings.
  // applyVariableUpdates in main/index.ts treats a same-name mapping as
  // "update this existing variable," not "create a separate one."
  const usedVariableNames = useMemo(() => {
    const set = new Set(variables.map((v) => v.name))
    for (const source of eventSources) {
      for (const mapping of source.mappings) {
        if (mapping.variableName) set.add(mapping.variableName)
      }
    }
    return set
  }, [variables, eventSources])

  const enabledDataSources = useDashboardStore((s) => s.enabledDataSources)
  const requestAppSettings = useDashboardStore((s) => s.requestAppSettings)
  const dcsBiosAircraft = useDashboardStore((s) => s.dcsBiosAircraft)
  const requestDcsBiosAircraftList = useDashboardStore((s) => s.requestDcsBiosAircraftList)
  const dcsBiosFieldCatalogs = useDashboardStore((s) => s.dcsBiosFieldCatalogs)
  const requestDcsBiosFieldCatalog = useDashboardStore((s) => s.requestDcsBiosFieldCatalog)
  const dcsBiosSettings = useDashboardStore((s) => s.dcsBiosSettings)
  const requestDcsBiosSettings = useDashboardStore((s) => s.requestDcsBiosSettings)
  const openSettings = useEditorSettings((s) => s.openSettings)
  const screenCaptureDisplays = useDashboardStore((s) => s.screenCaptureDisplays)
  const requestScreenCaptureDisplays = useDashboardStore((s) => s.requestScreenCaptureDisplays)
  const pickEventSourceRegion = useDashboardStore((s) => s.pickEventSourceRegion)

  const usesDcsBios = eventSources.some((s) => s.kind === 'dcsbios')
  const usesOcrRegion = eventSources.some((s) => s.kind === 'ocrRegion')

  useEffect(() => {
    if (enabledDataSources === null) requestAppSettings()
  }, [enabledDataSources, requestAppSettings])

  useEffect(() => {
    if (usesDcsBios && dcsBiosAircraft === null) requestDcsBiosAircraftList()
  }, [usesDcsBios, dcsBiosAircraft, requestDcsBiosAircraftList])

  useEffect(() => {
    if (usesDcsBios && dcsBiosSettings === null) requestDcsBiosSettings()
  }, [usesDcsBios, dcsBiosSettings, requestDcsBiosSettings])

  useEffect(() => {
    if (usesOcrRegion && screenCaptureDisplays === null) requestScreenCaptureDisplays()
  }, [usesOcrRegion, screenCaptureDisplays, requestScreenCaptureDisplays])

  const enabledKinds = enabledDataSources ?? EVENT_SOURCE_TYPES.map((t) => t.kind)
  const addableTypes = EVENT_SOURCE_TYPES.filter((t) => enabledKinds.includes(t.kind))

  function patchSource(id: string, fields: Partial<EventSource>): void {
    updateDashboardMeta({ eventSources: eventSources.map((s) => (s.id === id ? { ...s, ...fields } : s)) })
  }

  function removeSource(id: string): void {
    updateDashboardMeta({ eventSources: eventSources.filter((s) => s.id !== id) })
  }

  function addSource(kind: string): void {
    const typeMeta = getEventSourceType(kind)
    if (!typeMeta) return
    const config =
      kind === 'dcsbios'
        ? { aircraft: '', updateHz: dcsBiosSettings?.defaultUpdateHz ?? DEFAULT_UPDATE_HZ }
        : kind === 'ocrRegion'
          ? { intervalMs: DEFAULT_OCR_INTERVAL_MS }
          : undefined
    const id = nextId()
    updateDashboardMeta({
      eventSources: [...eventSources, { id, kind, name: typeMeta.label, mappings: [], config }]
    })
    setActiveSourceId(id)
    setAddPickerOpen(false)
  }

  function addMapping(source: EventSource): void {
    const typeMeta = getEventSourceType(source.kind)
    const firstField = typeMeta?.fields[0]?.key ?? ''
    const variableName = uniqueVariableName('new_variable', usedVariableNames)
    const mapping: EventSourceMapping = { id: nextId(), field: firstField, variableName }
    patchSource(source.id, { mappings: [...source.mappings, mapping] })
  }

  function patchMapping(source: EventSource, mappingId: string, fields: Partial<EventSourceMapping>): void {
    patchSource(source.id, {
      mappings: source.mappings.map((m) => (m.id === mappingId ? { ...m, ...fields } : m))
    })
  }

  function removeMapping(source: EventSource, mappingId: string): void {
    patchSource(source.id, { mappings: source.mappings.filter((m) => m.id !== mappingId) })
  }

  function openFieldBrowser(source: EventSource): void {
    const aircraft = typeof source.config?.aircraft === 'string' ? source.config.aircraft : ''
    if (!aircraft) return
    if (dcsBiosFieldCatalogs[aircraft] === undefined) requestDcsBiosFieldCatalog(aircraft)
    setBrowserOpenForSourceId(source.id)
  }

  function handleAddMappings(source: EventSource, mappings: EventSourceMapping[]): void {
    if (mappings.length > 0) patchSource(source.id, { mappings: [...source.mappings, ...mappings] })
    setBrowserOpenForSourceId(null)
  }

  return (
    <div className="variables-modal-overlay" onPointerDown={onClose}>
      <div className="variables-modal events-modal" onPointerDown={(e) => e.stopPropagation()}>
        <div className="variables-modal__header">
          <h2 className="variables-modal__title">Events</h2>
          <button type="button" className="modal-close" title="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="variables-modal__body">
        <p className="properties__hint">
          Continuously running sources of data (a clock, DCS-BIOS telemetry, and more to come) whose fields you can
          map into <code>variables</code>, optionally through an expression.
        </p>

        {eventSources.length === 0 && <p className="properties__hint">No event sources yet.</p>}

        {eventSources.length > 0 && (
          <div className="variables-modal__tabs">
            {eventSources.map((source) => (
              <button
                key={source.id}
                type="button"
                className={`variables-modal__tab${activeSourceId === source.id ? ' variables-modal__tab--active' : ''}`}
                onClick={() => setActiveSourceId(source.id)}
              >
                {source.name}
                <span className="variables-modal__group-count">{source.mappings.length}</span>
              </button>
            ))}
          </div>
        )}

        <div className="variables-modal__scroll">
        {(() => {
          const source = eventSources.find((s) => s.id === activeSourceId)
          if (!source) return null

          const typeMeta = getEventSourceType(source.kind)
          const isDynamic = !!typeMeta?.dynamicFields
          const kindEnabled = enabledKinds.includes(source.kind)
          const aircraft = typeof source.config?.aircraft === 'string' ? source.config.aircraft : ''
          const catalogState = isDynamic ? dcsBiosFieldCatalogs[aircraft] : undefined
          const catalogEntries = Array.isArray(catalogState) ? catalogState : []
          const catalogByKey = new Map(catalogEntries.map((e) => [e.key, e]))
          const updateHz = typeof source.config?.updateHz === 'number' ? source.config.updateHz : DEFAULT_UPDATE_HZ

          const isOcrRegion = source.kind === 'ocrRegion'
          const ocrDisplayId = typeof source.config?.displayId === 'number' ? source.config.displayId : undefined
          const ocrRegion = source.config?.region as ScreenRegion | undefined
          const ocrRegionSummary = ocrRegion
            ? `${Math.round(ocrRegion.width)}×${Math.round(ocrRegion.height)} at (${Math.round(ocrRegion.x)}, ${Math.round(ocrRegion.y)})`
            : 'No region selected'
          const ocrIntervalMs = typeof source.config?.intervalMs === 'number' ? source.config.intervalMs : DEFAULT_OCR_INTERVAL_MS

          return (
            <div className="events-modal__source">
              <div className="events-modal__source-header">
                <input
                  className="events-modal__source-name"
                  value={source.name}
                  onChange={(e) => patchSource(source.id, { name: e.target.value })}
                />
                <span className="events-modal__source-kind">{typeMeta?.label ?? source.kind}</span>
                <button
                  type="button"
                  className="variables-modal__remove"
                  title="Delete event source"
                  onClick={() => removeSource(source.id)}
                >
                  ×
                </button>
              </div>

              {isDynamic && !kindEnabled && (
                <p className="properties__hint dcsbios-settings__error">
                  Disabled — enable DCS-BIOS in Settings to resume; mapped variables are frozen at their last value.{' '}
                  <button type="button" className="events-modal__configure-link" onClick={() => openSettings(source.kind)}>
                    Open Settings
                  </button>
                </p>
              )}

              {isDynamic && kindEnabled && <DcsBiosStatusBanner onConfigure={() => openSettings(source.kind)} />}

              {isDynamic && (
                <div className="events-modal__source-config">
                  <label className="dcsbios-settings__field">
                    <span>Aircraft</span>
                    {dcsBiosAircraft === null ? (
                      <span className="properties__hint-inline">Loading aircraft…</span>
                    ) : dcsBiosAircraft.length === 0 ? (
                      <span className="properties__hint-inline">
                        No installed DCS-BIOS aircraft found — check the docs folder in Settings.
                      </span>
                    ) : (
                      <select
                        value={aircraft}
                        onChange={(e) => patchSource(source.id, { config: { ...source.config, aircraft: e.target.value } })}
                      >
                        <option value="">Pick an aircraft…</option>
                        {dcsBiosAircraft.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </label>
                  <label className="dcsbios-settings__field">
                    <span>Update frequency: {updateHz}/sec</span>
                    <input
                      type="range"
                      min={MIN_UPDATE_HZ}
                      max={MAX_UPDATE_HZ}
                      value={updateHz}
                      onChange={(e) => patchSource(source.id, { config: { ...source.config, updateHz: Number(e.target.value) } })}
                    />
                    <span className="properties__hint-inline">
                      How often this source's mapped variables refresh — lower this if you don't need every change
                      instantly and want to reduce broadcast/save load.
                    </span>
                  </label>
                </div>
              )}

              {isOcrRegion && (
                <div className="events-modal__source-config">
                  <label className="dcsbios-settings__field">
                    <span>Monitor</span>
                    <select
                      value={ocrDisplayId ?? ''}
                      onChange={(e) =>
                        patchSource(source.id, { config: { ...source.config, displayId: Number(e.target.value) } })
                      }
                    >
                      <option value="">Pick a monitor…</option>
                      {(screenCaptureDisplays ?? []).map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="dcsbios-settings__field">
                    <span>Region: {ocrRegionSummary}</span>
                    <button
                      type="button"
                      className="properties__file-button"
                      disabled={(screenCaptureDisplays ?? []).length === 0}
                      onClick={() => pickEventSourceRegion(source.id, ocrDisplayId ?? screenCaptureDisplays?.[0]?.id ?? 0)}
                    >
                      Pick region
                    </button>
                  </div>
                  <label className="dcsbios-settings__field">
                    <span>Poll interval: {ocrIntervalMs}ms</span>
                    <input
                      type="range"
                      min={MIN_OCR_INTERVAL_MS}
                      max={MAX_OCR_INTERVAL_MS}
                      step={100}
                      value={ocrIntervalMs}
                      onChange={(e) =>
                        patchSource(source.id, { config: { ...source.config, intervalMs: Number(e.target.value) } })
                      }
                    />
                    <span className="properties__hint-inline">
                      How often the region is re-captured and OCR'd. Recognition itself may take longer than this on
                      a slow machine — ticks never overlap regardless of what this is set to.
                    </span>
                  </label>
                </div>
              )}

              {source.mappings.length === 0 && <p className="properties__hint">No mappings yet.</p>}

              {source.mappings.map((mapping) => (
                <MappingRow
                  key={mapping.id}
                  mapping={mapping}
                  typeMeta={typeMeta}
                  fieldLabel={isDynamic ? catalogByKey.get(mapping.field)?.label : undefined}
                  onPatch={(fields) => patchMapping(source, mapping.id, fields)}
                  onRemove={() => removeMapping(source, mapping.id)}
                />
              ))}

              {isDynamic ? (
                browserOpenForSourceId === source.id ? (
                  <DcsBiosFieldBrowser
                    catalogState={catalogState}
                    existingVariableNames={usedVariableNames}
                    onClose={() => setBrowserOpenForSourceId(null)}
                    onAdd={(mappings) => handleAddMappings(source, mappings)}
                  />
                ) : (
                  <button
                    type="button"
                    className="properties__file-button"
                    disabled={!aircraft}
                    onClick={() => openFieldBrowser(source)}
                  >
                    + Add mapping(s)
                  </button>
                )
              ) : (
                <button type="button" className="properties__file-button" onClick={() => addMapping(source)}>
                  + Add mapping
                </button>
              )}
            </div>
          )
        })()}
        </div>

        <div className="variables-modal__actions">
          <div className="events-modal__add">
            <button type="button" className="properties__file-button" onClick={() => setAddPickerOpen((o) => !o)}>
              + Add event source
            </button>
            {addPickerOpen && (
              <div className="events-modal__add-picker">
                {addableTypes.map((type) => (
                  <button key={type.kind} type="button" onClick={() => addSource(type.kind)}>
                    {type.label}
                  </button>
                ))}
                {addableTypes.length === 0 && <p className="properties__hint">No data sources enabled — check Settings.</p>}
              </div>
            )}
          </div>
          <button type="button" className="device-modal__save" onClick={onClose}>
            Close
          </button>
        </div>
        </div>
      </div>
    </div>
  )
}
