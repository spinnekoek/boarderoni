import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useDashboardStore, type DcsBiosFieldCatalogState } from '../store'
import { useEditorSettings } from '../settingsStore'
import { nextId } from '../id'
import { useEscapeToClose } from '../useEscapeToClose'
import { uniqueVariableName } from '../variableNaming'
import { CodeEditor } from './CodeEditor'
import { ExpressionEditorModal } from './ExpressionEditorModal'
import { getPluginType, instantiablePluginTypes, type PluginTypeMeta } from '@shared/plugins'
import type { Plugin, PluginMapping } from '@shared/types'
import type { DcsBiosFieldCatalogEntry } from '@shared/dcsBiosTypes'
import { PLUGIN_CONFIG_PANELS, defaultDcsBiosConfig, DEFAULT_OCR_INTERVAL_MS, defaultWindowsAudioConfig } from '../plugins'

// Kept to a single line deliberately — CodeMirror's placeholder extension
// renders an embedded "\n" as an actual second visual row, so the empty
// editor would render two rows tall and then visibly shrink to one the
// moment real (single-line) text replaces the placeholder.
const EXPR_PLACEHOLDER = 'return variables.$value;'

const FIELD_VIRTUALIZE_THRESHOLD = 100
const FIELD_ROW_HEIGHT = 40

// A per-dashboard instance's own display label — most kinds just use the
// plugin's own name, but a kind whose instanceLabel diverges (Screen
// Capture + OCR → "OCR") uses that instead, everywhere an instance (not the
// plugin capability itself) is being talked about: the add-picker, a
// source's own kind badge, its default name on creation.
function instanceLabelFor(typeMeta: PluginTypeMeta | undefined, fallback: string): string {
  return typeMeta?.instanceLabel ?? typeMeta?.label ?? fallback
}

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
  mapping: PluginMapping
  typeMeta: PluginTypeMeta | undefined
  // Only meaningful for a dynamicFields kind — the field's human label
  // looked up from its cached catalog, if loaded. Falls back to the raw
  // field key when the catalog isn't available (e.g. right after reload,
  // before this source's aircraft catalog has been re-fetched).
  fieldLabel?: string
  onPatch: (fields: Partial<PluginMapping>) => void
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
          // syncPlugins). Same pattern VariablesModal's own Value field
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
//
// DCS-BIOS-flavored (DcsBiosFieldCatalogEntry) rather than a fully generic
// dynamicFields browser — DCS-BIOS is the only dynamicFields plugin today.
// A future dynamicFields plugin currently means adding its own browser here
// too; see CONTRIBUTING.md's "Adding a plugin" section for the line between
// what's generic vs. DCS-BIOS-specific in this file.
function DcsBiosFieldBrowser({
  catalogState,
  existingVariableNames,
  onClose,
  onAdd
}: {
  catalogState: DcsBiosFieldCatalogState | undefined
  existingVariableNames: Set<string>
  onClose: () => void
  onAdd: (mappings: PluginMapping[]) => void
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

  const allFilteredChecked = filtered.length > 0 && filtered.every((e) => checked.has(e.key))
  const someFilteredChecked = filtered.some((e) => checked.has(e.key))
  const selectAllRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someFilteredChecked && !allFilteredChecked
  }, [someFilteredChecked, allFilteredChecked])

  function toggle(key: string): void {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Scoped to the filtered set, not every entry in the catalog — with a
  // search narrowing hundreds of fields down to a handful, "select all"
  // should mean "all matches," not silently also check everything hidden
  // by the filter.
  function toggleAll(): void {
    setChecked((prev) => {
      const next = new Set(prev)
      if (allFilteredChecked) {
        for (const e of filtered) next.delete(e.key)
      } else {
        for (const e of filtered) next.add(e.key)
      }
      return next
    })
  }

  function handleAdd(): void {
    const taken = new Set(existingVariableNames)
    const mappings: PluginMapping[] = []
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
          {filtered.length > 0 && (
            <label className="events-modal__field-select-all">
              <input type="checkbox" ref={selectAllRef} checked={allFilteredChecked} onChange={toggleAll} />
              <span>
                Select all {hasSearch ? `${filtered.length} matching` : filtered.length} field{filtered.length === 1 ? '' : 's'}
              </span>
            </label>
          )}
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

// Mirrors VariablesModal.tsx's structure: overlay/panel, mutates only
// through updateDashboardMeta (no dedicated store actions), no new WS
// message types needed since a full dashboard:update already round-trips
// (the DCS-BIOS-specific WS messages this modal also uses — aircraft list,
// field catalogs, status/stats — are separate, handled via the store's own
// request actions/message branches, see store.ts).
//
// Per-dashboard INSTANCES of a plugin, each producing fields you map into
// variables — enabling/disabling the underlying plugin kind itself, and any
// app-wide config it needs, lives in the separate PluginsModal.tsx (see
// openPluginsModal in settingsStore.ts for how a disabled-kind hint here
// jumps over there). Per-kind config UI beyond the generic mapping list
// below is dispatched through PLUGIN_CONFIG_PANELS (see
// renderer/src/plugins/index.ts) — this file itself has no DCS-BIOS/
// Screen-Capture-specific config JSX, only the DCS-BIOS field browser
// above, which is about ADDING mappings for any dynamicFields plugin, not
// any one kind's own settings.
export function EventSourcesModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  // Selected specifically (not the whole dashboard) — once a source is
  // ticking, dashboard:sync arrives about once a second, but a
  // variables-only tick leaves this array's reference untouched (see
  // applyVariableUpdates in main/index.ts), so this selector naturally never
  // re-renders while someone's mid-edit here. Widening this to `s.dashboard`
  // would thrash the UI (and fight CodeEditor's cursor-preserving update
  // effect) every second.
  const plugins = useDashboardStore((s) => s.dashboard.plugins) ?? []
  const variables = useDashboardStore((s) => s.dashboard.variables) ?? []
  const updateDashboardMeta = useDashboardStore((s) => s.updateDashboardMeta)
  const [addPickerOpen, setAddPickerOpen] = useState(false)
  const [browserOpenForSourceId, setBrowserOpenForSourceId] = useState<string | null>(null)
  // Lives in useEditorSettings, not local state — see that field's own
  // comment for why (this modal fully unmounts on close).
  const activeSourceId = useEditorSettings((s) => s.eventSourcesModalActiveSourceId)
  const setActiveSourceId = useEditorSettings((s) => s.setEventSourcesModalActiveSourceId)
  const openPluginsModal = useEditorSettings((s) => s.openPluginsModal)
  useEscapeToClose(onClose)

  // Falls back to the first remaining source if the active tab's source was
  // removed (or defaults to the first source on initial load).
  useEffect(() => {
    if (plugins.length === 0) {
      setActiveSourceId(null)
      return
    }
    if (!plugins.some((s) => s.id === activeSourceId)) setActiveSourceId(plugins[0].id)
  }, [plugins, activeSourceId])

  // Dashboard-wide, not per-source — a new mapping's auto-generated name
  // must avoid colliding with ANY existing variable (another source's
  // mapping, or a manual one), not just this source's own mappings.
  // applyVariableUpdates in main/index.ts treats a same-name mapping as
  // "update this existing variable," not "create a separate one."
  const usedVariableNames = useMemo(() => {
    const set = new Set(variables.map((v) => v.name))
    for (const source of plugins) {
      for (const mapping of source.mappings) {
        if (mapping.variableName) set.add(mapping.variableName)
      }
    }
    return set
  }, [variables, plugins])

  const enabledPlugins = useDashboardStore((s) => s.enabledPlugins)
  const requestAppSettings = useDashboardStore((s) => s.requestAppSettings)
  const dcsBiosFieldCatalogs = useDashboardStore((s) => s.dcsBiosFieldCatalogs)
  const requestDcsBiosFieldCatalog = useDashboardStore((s) => s.requestDcsBiosFieldCatalog)
  const dcsBiosSettings = useDashboardStore((s) => s.dcsBiosSettings)

  useEffect(() => {
    if (enabledPlugins === null) requestAppSettings()
  }, [enabledPlugins, requestAppSettings])

  const enabledKinds = enabledPlugins ?? []
  const addableTypes = instantiablePluginTypes(enabledKinds)

  function patchSource(id: string, fields: Partial<Plugin>): void {
    updateDashboardMeta({ plugins: plugins.map((s) => (s.id === id ? { ...s, ...fields } : s)) })
  }

  function removeSource(id: string): void {
    updateDashboardMeta({ plugins: plugins.filter((s) => s.id !== id) })
  }

  // Per-kind default config on creation — deliberately left as a small
  // switch here rather than a fully generic factory: only two kinds need
  // anything beyond `undefined`, and both need live app state (DCS-BIOS's
  // default update rate) that doesn't belong in shared/plugins' plain
  // metadata. See CONTRIBUTING.md if a new plugin needs to join this list.
  function defaultConfigFor(kind: string): Record<string, unknown> | undefined {
    if (kind === 'dcsbios') return defaultDcsBiosConfig(dcsBiosSettings?.defaultUpdateHz)
    if (kind === 'screenCapture') return { intervalMs: DEFAULT_OCR_INTERVAL_MS }
    if (kind === 'windowsAudio') return defaultWindowsAudioConfig()
    return undefined
  }

  function addSource(kind: string): void {
    const typeMeta = getPluginType(kind)
    if (!typeMeta) return
    const id = nextId()
    updateDashboardMeta({
      plugins: [...plugins, { id, kind, name: instanceLabelFor(typeMeta, kind), mappings: [], config: defaultConfigFor(kind) }]
    })
    setActiveSourceId(id)
    setAddPickerOpen(false)
  }

  function addMapping(source: Plugin): void {
    const typeMeta = getPluginType(source.kind)
    const firstField = typeMeta?.fields[0]?.key ?? ''
    const variableName = uniqueVariableName('new_variable', usedVariableNames)
    const mapping: PluginMapping = { id: nextId(), field: firstField, variableName }
    patchSource(source.id, { mappings: [...source.mappings, mapping] })
  }

  function patchMapping(source: Plugin, mappingId: string, fields: Partial<PluginMapping>): void {
    patchSource(source.id, {
      mappings: source.mappings.map((m) => (m.id === mappingId ? { ...m, ...fields } : m))
    })
  }

  function removeMapping(source: Plugin, mappingId: string): void {
    patchSource(source.id, { mappings: source.mappings.filter((m) => m.id !== mappingId) })
  }

  function openFieldBrowser(source: Plugin): void {
    const aircraft = typeof source.config?.aircraft === 'string' ? source.config.aircraft : ''
    if (!aircraft) return
    if (dcsBiosFieldCatalogs[aircraft] === undefined) requestDcsBiosFieldCatalog(aircraft)
    setBrowserOpenForSourceId(source.id)
  }

  function handleAddMappings(source: Plugin, mappings: PluginMapping[]): void {
    if (mappings.length > 0) patchSource(source.id, { mappings: [...source.mappings, ...mappings] })
    setBrowserOpenForSourceId(null)
  }

  return (
    <div className="variables-modal-overlay" onPointerDown={onClose}>
      <div className="variables-modal events-modal" onPointerDown={(e) => e.stopPropagation()}>
        <div className="variables-modal__header">
          <h2 className="variables-modal__title">Event Sources</h2>
          <button type="button" className="modal-close" title="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="variables-modal__body">
        <p className="properties__hint">
          Continuously running instances of a plugin (a clock, DCS-BIOS telemetry, OCR, and more to come) whose
          fields you can map into <code>variables</code>, optionally through an expression. Enable/disable plugins
          themselves from the Plugins toolbar button.
        </p>

        {plugins.length === 0 && <p className="properties__hint">No event sources added yet.</p>}

        {plugins.length > 0 && (
          <div className="variables-modal__tabs">
            {plugins.map((source) => (
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
          const source = plugins.find((s) => s.id === activeSourceId)
          if (!source) return null

          const typeMeta = getPluginType(source.kind)
          const isDynamic = !!typeMeta?.dynamicFields
          const kindEnabled = enabledKinds.includes(source.kind)
          const aircraft = typeof source.config?.aircraft === 'string' ? source.config.aircraft : ''
          const catalogState = isDynamic ? dcsBiosFieldCatalogs[aircraft] : undefined
          const catalogEntries = Array.isArray(catalogState) ? catalogState : []
          const catalogByKey = new Map(catalogEntries.map((e) => [e.key, e]))
          const kindLabel = instanceLabelFor(typeMeta, source.kind)

          const ConfigPanel = PLUGIN_CONFIG_PANELS[source.kind]

          return (
            <div className="events-modal__source">
              <div className="events-modal__source-header">
                <input
                  className="events-modal__source-name"
                  value={source.name}
                  onChange={(e) => patchSource(source.id, { name: e.target.value })}
                />
                <span className="events-modal__source-kind">{kindLabel}</span>
                <button type="button" className="variables-modal__remove" title="Remove event source" onClick={() => removeSource(source.id)}>
                  ×
                </button>
              </div>

              {!kindEnabled && (
                <p className="properties__hint dcsbios-settings__error">
                  Disabled — enable {typeMeta?.label ?? source.kind} to resume; mapped variables are frozen at their last value.{' '}
                  <button type="button" className="events-modal__configure-link" onClick={() => openPluginsModal(source.kind)}>
                    Open Plugins
                  </button>
                </p>
              )}

              {ConfigPanel && (
                <ConfigPanel
                  source={source}
                  kindEnabled={kindEnabled}
                  onPatchConfig={(config) => patchSource(source.id, { config })}
                  onOpenSettings={() => openPluginsModal(source.kind)}
                />
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
                    {type.instanceLabel ?? type.label}
                  </button>
                ))}
                {addableTypes.length === 0 && (
                  <p className="properties__hint">
                    No plugins enabled —{' '}
                    <button type="button" className="events-modal__configure-link" onClick={() => openPluginsModal()}>
                      open Plugins
                    </button>
                    .
                  </p>
                )}
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
