import { useEffect, useState } from 'react'
import { useDashboardStore } from '../store'
import { nextId } from '../id'
import { editorHeaders } from '../electronBridge'
import { SERVER_PORT } from '@shared/constants'
import type { DeckSummary, RestDataSourceStatus, RestIncomingMapping } from '@shared/types'
import { RestMappingRow } from './RestMappingRow'

function apiUrl(path: string): string {
  const host = window.location.hostname || 'localhost'
  return `http://${host}:${SERVER_PORT}${path}`
}

// App-wide, user-created REST data sources (see main/restDataSources.ts) —
// rendered as its own standalone Settings section (like "Approved devices"),
// not through PLUGIN_TYPES/DATA_SOURCE_SETTINGS_PANELS, since these
// are user-created multiple instances rather than one of a small fixed set
// of kinds. Incoming-only — see RestWebhookTargetsSettingsPanel for the
// unrelated outgoing direction, split out of what used to be this same
// panel's own "Outgoing" section. Every field edit round-trips immediately
// via updateRestDataSources (whole-list replace), same "no separate Save
// step" style EventSourcesModal already uses for its own list-of-instances
// editing — except `port`, `field`, and `variableName`, which commit on
// blur instead of onChange (see their own comments) to avoid restarting a
// listener or creating a phantom variable on every keystroke.
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
    fetch(apiUrl('/api/decks'), { headers: editorHeaders() })
      .then((res) => res.json() as Promise<DeckSummary[]>)
      .then(setDecks)
      .catch(() => setDecks([]))
  }, [])

  function patchSource(id: string, fields: Partial<RestDataSourceStatus>): void {
    updateRestDataSources(sources.map((s) => (s.id === id ? { ...s, ...fields } : s)))
  }

  function addMapping(source: RestDataSourceStatus): void {
    const mapping: RestIncomingMapping = { id: nextId(), field: '', variableName: '' }
    patchSource(source.id, { mappings: [...source.mappings, mapping] })
  }

  function patchMapping(source: RestDataSourceStatus, mappingId: string, fields: Partial<RestIncomingMapping>): void {
    patchSource(source.id, { mappings: source.mappings.map((m) => (m.id === mappingId ? { ...m, ...fields } : m)) })
  }

  function removeMapping(source: RestDataSourceStatus, mappingId: string): void {
    patchSource(source.id, { mappings: source.mappings.filter((m) => m.id !== mappingId) })
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
        Independently-ported REST receivers — this app runs a small HTTP server per source, mapping whatever hits it
        into a chosen deck's variables.
      </p>

      {sources.length === 0 && <p className="properties__hint">No REST data sources yet.</p>}

      {sources.map((source) => {
        const endpointUrl = lanAddress ? `http://${lanAddress}:${source.port}` : null

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

              <label className="dcsbios-settings__field">
                <span>Port</span>
                <input
                  type="number"
                  defaultValue={source.port}
                  key={`${source.id}-port-${source.port}`}
                  onBlur={(e) => patchSource(source.id, { port: Number(e.target.value) })}
                />
              </label>
              <label className="dcsbios-settings__field">
                <span>Bearer token</span>
                <div className="properties__file-row">
                  <input readOnly value={source.bearerToken} />
                  <button type="button" className="properties__file-button" onClick={() => handleCopy(source.bearerToken, source.id)}>
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
                  <select value={source.targetDeckId} onChange={(e) => patchSource(source.id, { targetDeckId: e.target.value })}>
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

              {source.mappings.length === 0 && <p className="properties__hint">No mappings yet.</p>}
              {source.mappings.map((mapping) => (
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
