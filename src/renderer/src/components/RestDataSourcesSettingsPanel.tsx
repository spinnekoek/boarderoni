import { useEffect, useRef, useState } from 'react'
import { useDashboardStore } from '../store'
import { CodeEditor } from './CodeEditor'
import { ExpressionEditorModal } from './ExpressionEditorModal'
import { nextId } from '../id'
import { extractPlaceholders } from '@shared/restPlaceholders'
import { SERVER_PORT } from '@shared/constants'
import type { DeckSummary, RestDataSourceStatus, RestIncomingMapping } from '@shared/types'

// Kept to a single line deliberately, same reasoning as EventsModal's own
// EXPR_PLACEHOLDER — CodeMirror's placeholder extension renders an embedded
// "\n" as a real second visual row.
const EXPR_PLACEHOLDER = 'return variables.$value;'

function apiUrl(path: string): string {
  const host = window.location.hostname || 'localhost'
  return `http://${host}:${SERVER_PORT}${path}`
}

// One incoming mapping row — same fx → inline panel → expand-to-modal
// interaction as EventsModal.tsx's own MappingRow (reusing its exact CSS
// classes), except `field` is a free-text dot/index path (see
// shared/flattenJson.ts) rather than a `<select>` over a static/catalog
// field list, since a REST body has no fixed field set.
function RestMappingRow({
  mapping,
  onPatch,
  onRemove
}: {
  mapping: RestIncomingMapping
  onPatch: (fields: Partial<RestIncomingMapping>) => void
  onRemove: () => void
}): React.JSX.Element {
  const isExpr = mapping.expr !== undefined
  const [expanded, setExpanded] = useState(false)
  const draftRef = useRef(mapping.expr ?? '')
  useEffect(() => {
    if (mapping.expr) draftRef.current = mapping.expr
  }, [mapping.expr])

  return (
    <div className="events-modal__mapping">
      <div className="events-modal__mapping-row">
        <input
          className="events-modal__mapping-variable"
          // Uncontrolled + committed on blur, not onChange — a mismatched
          // config.port/token change restarts this source's listener (see
          // main/restIncoming.ts), so a live onChange here would restart it
          // on every keystroke. `field` itself doesn't restart anything, but
          // gets the same treatment for consistency with variableName below.
          defaultValue={mapping.field}
          key={`${mapping.id}-field-${mapping.field}`}
          placeholder="e.g. data.temperature"
          onBlur={(e) => onPatch({ field: e.target.value })}
        />
        <span className="events-modal__mapping-arrow">→</span>
        <input
          className="events-modal__mapping-variable"
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

// App-wide, user-created REST data sources (see main/restDataSources.ts) —
// rendered as its own standalone Settings section (like "Approved devices"),
// not through EVENT_SOURCE_TYPES/DATA_SOURCE_SETTINGS_PANELS, since these
// are user-created multiple instances rather than one of a small fixed set
// of kinds. Every field edit round-trips immediately via updateRestDataSources
// (whole-list replace), same "no separate Save step" style EventsModal
// already uses for its own list-of-instances editing — except `port`,
// `field`, and `variableName`, which commit on blur instead of onChange (see
// their own comments) to avoid restarting a listener or creating a phantom
// variable on every keystroke.
export function RestDataSourcesSettingsPanel(): React.JSX.Element {
  const sources = useDashboardStore((s) => s.restDataSources)
  const lanAddress = useDashboardStore((s) => s.restDataSourcesLanAddress)
  const requestRestDataSources = useDashboardStore((s) => s.requestRestDataSources)
  const createRestDataSource = useDashboardStore((s) => s.createRestDataSource)
  const updateRestDataSources = useDashboardStore((s) => s.updateRestDataSources)
  const regenerateRestDataSourceToken = useDashboardStore((s) => s.regenerateRestDataSourceToken)
  const deleteRestDataSource = useDashboardStore((s) => s.deleteRestDataSource)

  const [decks, setDecks] = useState<DeckSummary[] | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    requestRestDataSources()
  }, [requestRestDataSources])

  // Same REST fetch DeckPicker.tsx already uses for its own deck list — the
  // target-deck dropdown needs deck names, not just whichever deck happens
  // to be open right now.
  useEffect(() => {
    fetch(apiUrl('/api/decks'))
      .then((res) => res.json() as Promise<DeckSummary[]>)
      .then(setDecks)
      .catch(() => setDecks([]))
  }, [])

  function patchSource(id: string, fields: Partial<RestDataSourceStatus>): void {
    updateRestDataSources(sources.map((s) => (s.id === id ? { ...s, ...fields } : s)))
  }

  function addMapping(source: RestDataSourceStatus): void {
    const mapping: RestIncomingMapping = { id: nextId(), field: '', variableName: '' }
    patchSource(source.id, { incoming: { ...source.incoming, mappings: [...source.incoming.mappings, mapping] } })
  }

  function patchMapping(source: RestDataSourceStatus, mappingId: string, fields: Partial<RestIncomingMapping>): void {
    patchSource(source.id, {
      incoming: { ...source.incoming, mappings: source.incoming.mappings.map((m) => (m.id === mappingId ? { ...m, ...fields } : m)) }
    })
  }

  function removeMapping(source: RestDataSourceStatus, mappingId: string): void {
    patchSource(source.id, { incoming: { ...source.incoming, mappings: source.incoming.mappings.filter((m) => m.id !== mappingId) } })
  }

  function handleCopy(token: string, id: string): void {
    navigator.clipboard.writeText(token).then(() => {
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1500)
    })
  }

  return (
    <div className="settings-modal__sources">
      <p className="properties__hint">
        Independently-ported REST integrations, each with an incoming listener (mapped into a chosen deck's
        variables) and/or an outgoing payload callable from any widget's actions.
      </p>

      {sources.length === 0 && <p className="properties__hint">No REST data sources yet.</p>}

      {sources.map((source) => {
        const placeholders = extractPlaceholders(source.outgoing.payloadTemplate)
        const endpointUrl = lanAddress ? `http://${lanAddress}:${source.incoming.port}` : null

        return (
          <details key={source.id} className="settings-modal__source">
            <summary className="settings-modal__source-summary">
              <input
                className="events-modal__source-name"
                defaultValue={source.name}
                key={`${source.id}-name-${source.name}`}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => patchSource(source.id, { name: e.target.value })}
              />
              <label onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={source.enabled} onChange={(e) => patchSource(source.id, { enabled: e.target.checked })} />{' '}
                Enabled
              </label>
              <button
                type="button"
                className="variables-modal__remove"
                title="Delete REST data source"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  deleteRestDataSource(source.id)
                }}
              >
                ×
              </button>
            </summary>

            <div className="settings-modal__source-panel">
              {source.enabled && !source.listening && (
                <p className="properties__hint dcsbios-settings__error">
                  {source.listenError ? `Not listening: ${source.listenError}` : 'Starting…'}
                </p>
              )}

              <h4 className="settings-modal__section-title">Incoming</h4>
              <label className="dcsbios-settings__field">
                <span>Port</span>
                <input
                  type="number"
                  defaultValue={source.incoming.port}
                  key={`${source.id}-port-${source.incoming.port}`}
                  onBlur={(e) => patchSource(source.id, { incoming: { ...source.incoming, port: Number(e.target.value) } })}
                />
              </label>
              <label className="dcsbios-settings__field">
                <span>Bearer token</span>
                <div className="properties__file-row">
                  <input readOnly value={source.incoming.bearerToken} />
                  <button
                    type="button"
                    className="properties__file-button"
                    onClick={() => handleCopy(source.incoming.bearerToken, source.id)}
                  >
                    {copiedId === source.id ? 'Copied!' : 'Copy'}
                  </button>
                  <button type="button" className="properties__file-button" onClick={() => regenerateRestDataSourceToken(source.id)}>
                    Regenerate
                  </button>
                </div>
              </label>
              <div className="dcsbios-settings__field">
                <span>Endpoint</span>
                <p className="properties__hint-inline">
                  {endpointUrl
                    ? `POST ${endpointUrl}  (header: Authorization: Bearer <token>)`
                    : 'Resolving this machine’s LAN address…'}
                </p>
              </div>
              <label className="dcsbios-settings__field">
                <span>Target deck</span>
                {decks === null ? (
                  <span className="properties__hint-inline">Loading decks…</span>
                ) : (
                  <select
                    value={source.incoming.targetDeckId}
                    onChange={(e) => patchSource(source.id, { incoming: { ...source.incoming, targetDeckId: e.target.value } })}
                  >
                    <option value="">Pick a deck…</option>
                    {decks.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                )}
                <span className="properties__hint-inline">Which deck's variables this source's mappings write into.</span>
              </label>

              {source.incoming.mappings.length === 0 && <p className="properties__hint">No mappings yet.</p>}
              {source.incoming.mappings.map((mapping) => (
                <RestMappingRow
                  key={mapping.id}
                  mapping={mapping}
                  onPatch={(fields) => patchMapping(source, mapping.id, fields)}
                  onRemove={() => removeMapping(source, mapping.id)}
                />
              ))}
              <button type="button" className="properties__file-button" onClick={() => addMapping(source)}>
                + Add mapping
              </button>

              <h4 className="settings-modal__section-title">Outgoing</h4>
              <label className="dcsbios-settings__field">
                <span>URL</span>
                <input
                  defaultValue={source.outgoing.url}
                  key={`${source.id}-url-${source.outgoing.url}`}
                  placeholder="https://example.com/webhook"
                  onBlur={(e) => patchSource(source.id, { outgoing: { ...source.outgoing, url: e.target.value } })}
                />
              </label>
              <label className="dcsbios-settings__field">
                <span>Payload template</span>
                <CodeEditor
                  value={source.outgoing.payloadTemplate}
                  onChange={(code) => patchSource(source.id, { outgoing: { ...source.outgoing, payloadTemplate: code } })}
                  placeholder={'{"value": {{myPlaceholder}}}'}
                />
                <span className="properties__hint-inline">
                  {placeholders.length > 0
                    ? `Detected placeholders: ${placeholders.join(', ')}`
                    : 'No {{placeholders}} found yet — wrap a token in double curly braces, e.g. {{value}}.'}
                </span>
              </label>
            </div>
          </details>
        )
      })}

      <div className="events-modal__add">
        <button type="button" className="properties__file-button" onClick={() => createRestDataSource('New REST source')}>
          + Add REST data source
        </button>
      </div>
    </div>
  )
}
