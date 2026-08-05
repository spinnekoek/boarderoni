import { useEffect, useRef, useState } from 'react'
import { useDashboardStore } from '../store'
import { nextId } from '../id'
import { useEscapeToClose } from '../useEscapeToClose'
import { CodeEditor } from './CodeEditor'
import { ExpressionEditorModal } from './ExpressionEditorModal'
import { EVENT_SOURCE_TYPES, getEventSourceType, type EventSourceTypeMeta } from '@shared/eventSources'
import type { EventSource, EventSourceMapping } from '@shared/types'

// Kept to a single line deliberately — CodeMirror's placeholder extension
// renders an embedded "\n" as an actual second visual row, so the empty
// editor would render two rows tall and then visibly shrink to one the
// moment real (single-line) text replaces the placeholder.
const EXPR_PLACEHOLDER = 'return variables.$value;'

// One mapping row. Its own component (rather than inline in the .map() below)
// specifically so it can hold its own expr-panel/expand state — same fx →
// inline panel → expand-to-modal interaction as ColorPickerButton.tsx, reused
// here via the same CSS classes (color-picker-button__fx/clear/expr-panel/
// expand). With no expr set, the field's raw value is mapped straight into
// the variable; fx opts into transforming it first.
function MappingRow({
  mapping,
  typeMeta,
  onPatch,
  onRemove
}: {
  mapping: EventSourceMapping
  typeMeta: EventSourceTypeMeta | undefined
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
        <select value={mapping.field} onChange={(e) => onPatch({ field: e.target.value })}>
          {typeMeta?.fields.map((field) => (
            <option key={field.key} value={field.key}>
              {field.label}
            </option>
          ))}
        </select>
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

// Mirrors VariablesModal.tsx's structure: overlay/panel, mutates only
// through updateDashboardMeta (no dedicated store actions), no new WS
// message types needed since a full dashboard:update already round-trips.
export function EventsModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  // Selected specifically (not the whole dashboard) — once a source is
  // ticking, dashboard:sync arrives about once a second, but a
  // variables-only tick leaves this array's reference untouched (see
  // applyVariableUpdates in main/index.ts), so this selector naturally never
  // re-renders while someone's mid-edit here. Widening this to `s.dashboard`
  // would thrash the UI (and fight CodeEditor's cursor-preserving update
  // effect) every second.
  const eventSources = useDashboardStore((s) => s.dashboard.eventSources) ?? []
  const updateDashboardMeta = useDashboardStore((s) => s.updateDashboardMeta)
  const [addPickerOpen, setAddPickerOpen] = useState(false)
  useEscapeToClose(onClose)

  function patchSource(id: string, fields: Partial<EventSource>): void {
    updateDashboardMeta({ eventSources: eventSources.map((s) => (s.id === id ? { ...s, ...fields } : s)) })
  }

  function removeSource(id: string): void {
    updateDashboardMeta({ eventSources: eventSources.filter((s) => s.id !== id) })
  }

  function addSource(kind: string): void {
    const typeMeta = getEventSourceType(kind)
    if (!typeMeta) return
    updateDashboardMeta({
      eventSources: [...eventSources, { id: nextId(), kind, name: typeMeta.label, mappings: [] }]
    })
    setAddPickerOpen(false)
  }

  function addMapping(source: EventSource): void {
    const typeMeta = getEventSourceType(source.kind)
    const firstField = typeMeta?.fields[0]?.key ?? ''
    const mapping: EventSourceMapping = { id: nextId(), field: firstField, variableName: 'new_variable' }
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

  return (
    <div className="variables-modal-overlay" onPointerDown={onClose}>
      <div className="variables-modal events-modal" onPointerDown={(e) => e.stopPropagation()}>
        <h2 className="variables-modal__title">Events</h2>
        <p className="properties__hint">
          Continuously running sources of data (a clock, and more to come) whose fields you can map into{' '}
          <code>variables</code>, optionally through an expression.
        </p>

        {eventSources.length === 0 && <p className="properties__hint">No event sources yet.</p>}

        {eventSources.map((source) => {
          const typeMeta = getEventSourceType(source.kind)
          return (
            <div key={source.id} className="events-modal__source">
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

              {source.mappings.length === 0 && <p className="properties__hint">No mappings yet.</p>}

              {source.mappings.map((mapping) => (
                <MappingRow
                  key={mapping.id}
                  mapping={mapping}
                  typeMeta={typeMeta}
                  onPatch={(fields) => patchMapping(source, mapping.id, fields)}
                  onRemove={() => removeMapping(source, mapping.id)}
                />
              ))}

              <button type="button" className="properties__file-button" onClick={() => addMapping(source)}>
                + Add mapping
              </button>
            </div>
          )
        })}

        <div className="variables-modal__actions">
          <div className="events-modal__add">
            <button type="button" className="properties__file-button" onClick={() => setAddPickerOpen((o) => !o)}>
              + Add event source
            </button>
            {addPickerOpen && (
              <div className="events-modal__add-picker">
                {EVENT_SOURCE_TYPES.map((type) => (
                  <button key={type.kind} type="button" onClick={() => addSource(type.kind)}>
                    {type.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" className="device-modal__save" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
