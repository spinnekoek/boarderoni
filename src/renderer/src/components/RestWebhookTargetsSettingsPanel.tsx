import { useEffect } from 'react'
import { useDashboardStore } from '../store'
import { CodeEditor } from './CodeEditor'
import { nextId } from '../id'
import { extractAllPlaceholders } from '@shared/restPlaceholders'
import type { RestHttpMethod, RestWebhookHeader, RestWebhookTarget } from '@shared/types'

const HTTP_METHODS: RestHttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

// App-wide, user-created REST webhook targets (see
// main/restWebhookTargets.ts) — the outgoing counterpart split out of what
// used to be RestDataSourcesSettingsPanel's own "Outgoing" section (see that
// file's comment). No listener/port/token/target-deck here — a target is
// just a method/URL/headers/payload template a button's CallRestAction can
// point at, so this panel is considerably simpler than the incoming one.
// Same "round-trips immediately via updateRestWebhookTargets, whole-list
// replace" editing convention.
export function RestWebhookTargetsSettingsPanel(): React.JSX.Element {
  const targets = useDashboardStore((s) => s.restWebhookTargets)
  const requestRestWebhookTargets = useDashboardStore((s) => s.requestRestWebhookTargets)
  const createRestWebhookTarget = useDashboardStore((s) => s.createRestWebhookTarget)
  const updateRestWebhookTargets = useDashboardStore((s) => s.updateRestWebhookTargets)
  const deleteRestWebhookTarget = useDashboardStore((s) => s.deleteRestWebhookTarget)

  useEffect(() => {
    requestRestWebhookTargets()
  }, [requestRestWebhookTargets])

  function patchTarget(id: string, fields: Partial<RestWebhookTarget>): void {
    updateRestWebhookTargets(targets.map((t) => (t.id === id ? { ...t, ...fields } : t)))
  }

  function addHeader(target: RestWebhookTarget): void {
    const header: RestWebhookHeader = { id: nextId(), key: '', value: '' }
    patchTarget(target.id, { headers: [...target.headers, header] })
  }

  function patchHeader(target: RestWebhookTarget, headerId: string, fields: Partial<RestWebhookHeader>): void {
    patchTarget(target.id, { headers: target.headers.map((h) => (h.id === headerId ? { ...h, ...fields } : h)) })
  }

  function removeHeader(target: RestWebhookTarget, headerId: string): void {
    patchTarget(target.id, { headers: target.headers.filter((h) => h.id !== headerId) })
  }

  return (
    <div className="settings-modal__sources">
      <p className="properties__hint">
        Independently-named outgoing webhooks — a button's "Call REST" action sends the matching target's request
        (method, headers, and — for anything but GET — the payload template) to its URL.
      </p>

      {targets.length === 0 && <p className="properties__hint">No REST webhook targets yet.</p>}

      {targets.map((target) => {
        const hasBody = target.method !== 'GET'
        const placeholders = extractAllPlaceholders([target.payloadTemplate, ...target.headers.map((h) => h.value)])

        return (
          <details key={target.id} className="settings-modal__source">
            <summary className="settings-modal__source-summary">
              <input
                className="events-modal__source-name"
                defaultValue={target.name}
                key={`${target.id}-name-${target.name}`}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => patchTarget(target.id, { name: e.target.value })}
              />
              <label onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={target.enabled} onChange={(e) => patchTarget(target.id, { enabled: e.target.checked })} />{' '}
                Enabled
              </label>
              <button
                type="button"
                className="variables-modal__remove"
                title="Delete REST webhook target"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  deleteRestWebhookTarget(target.id)
                }}
              >
                ×
              </button>
            </summary>

            <div className="settings-modal__source-panel">
              <label className="dcsbios-settings__field">
                <span>Method</span>
                <select
                  value={target.method}
                  onChange={(e) => patchTarget(target.id, { method: e.target.value as RestHttpMethod })}
                >
                  {HTTP_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </select>
              </label>
              <label className="dcsbios-settings__field">
                <span>URL</span>
                <input
                  defaultValue={target.url}
                  key={`${target.id}-url-${target.url}`}
                  placeholder="https://example.com/webhook"
                  onBlur={(e) => patchTarget(target.id, { url: e.target.value })}
                />
              </label>
              <label className="dcsbios-settings__field">
                <input
                  type="checkbox"
                  checked={target.allowInvalidCertificates ?? false}
                  onChange={(e) => patchTarget(target.id, { allowInvalidCertificates: e.target.checked })}
                />{' '}
                Ignore invalid certificates
              </label>
              <span className="properties__hint-inline">
                Skips TLS certificate verification for this target only — for an https URL with a self-signed or otherwise invalid
                certificate (e.g. an internal device's own admin API). Leave off unless you hit a certificate error, since this makes
                requests to this URL vulnerable to interception.
              </span>

              <h4 className="settings-modal__section-title">Headers</h4>
              {target.headers.length === 0 && <p className="properties__hint">No headers yet — e.g. add one named "Authorization".</p>}
              {target.headers.map((header) => (
                <div className="events-modal__mapping-row" key={header.id}>
                  <input
                    className="events-modal__mapping-variable"
                    defaultValue={header.key}
                    key={`${header.id}-key-${header.key}`}
                    placeholder="Header name, e.g. Authorization"
                    onBlur={(e) => patchHeader(target, header.id, { key: e.target.value })}
                  />
                  <span className="events-modal__mapping-arrow">:</span>
                  <input
                    className="events-modal__mapping-variable"
                    defaultValue={header.value}
                    key={`${header.id}-value-${header.value}`}
                    placeholder="Value, e.g. Bearer {{token}}"
                    onBlur={(e) => patchHeader(target, header.id, { value: e.target.value })}
                  />
                  <button
                    type="button"
                    className="variables-modal__remove"
                    title="Delete header"
                    onClick={() => removeHeader(target, header.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button type="button" className="properties__file-button" onClick={() => addHeader(target)}>
                + Add header
              </button>

              {hasBody ? (
                <label className="dcsbios-settings__field">
                  <span>Payload template</span>
                  <CodeEditor
                    value={target.payloadTemplate}
                    onChange={(code) => patchTarget(target.id, { payloadTemplate: code })}
                    placeholder={'{"value": "{{myPlaceholder}}"}'}
                  />
                </label>
              ) : (
                <p className="properties__hint">GET requests don't send a body — the payload template below is ignored while this is GET.</p>
              )}
              <span className="properties__hint-inline">
                {placeholders.length > 0
                  ? `Detected placeholders: ${placeholders.join(', ')}`
                  : 'No {{placeholders}} found yet — wrap a token in double curly braces, e.g. {{value}}, in a header value or the payload template.'}
              </span>
            </div>
          </details>
        )
      })}

      <div className="events-modal__add">
        <button type="button" className="properties__file-button" onClick={() => createRestWebhookTarget('New webhook target')}>
          + Add REST webhook target
        </button>
      </div>
    </div>
  )
}
