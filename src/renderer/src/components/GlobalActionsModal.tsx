import { useEffect, useMemo, useState } from 'react'
import { useDashboardStore } from '../store'
import { useConfirmStore } from '../confirmStore'
import { nextId } from '../id'
import { useEscapeToClose } from '../useEscapeToClose'
import { ExpressionField } from './ExpressionField'
import { EventSequenceEditor } from './PropertiesPanel'
import type { GlobalAction } from '@shared/types'

// Pulls every `variables.foo` / `variables['foo']` reference out of a rule's
// condition, so the modal can point out one the watch list is missing. Same
// job React's own exhaustive-deps lint does for a useEffect, and for the
// same reason: forgetting a dependency is by far the easiest mistake to make
// here, and the symptom (a rule that reads correctly and never fires) gives
// no hint about the cause.
//
// Deliberately a regex rather than a real parse — it only ever drives a
// dismissable hint, never the actual evaluation, so a reference it misses
// (a computed `variables[key]`) costs nothing beyond not being suggested.
function referencedVariables(condition: string): string[] {
  const names = new Set<string>()
  for (const match of condition.matchAll(/\bvariables\s*\.\s*([A-Za-z_$][\w$]*)/g)) names.add(match[1])
  for (const match of condition.matchAll(/\bvariables\s*\[\s*['"]([^'"]+)['"]\s*\]/g)) names.add(match[1])
  return [...names]
}

function RuleEditor({
  rule,
  onChange,
  dcsBiosActionEnabled
}: {
  rule: GlobalAction
  onChange: (fields: Partial<GlobalAction>) => void
  dcsBiosActionEnabled: boolean
}): React.JSX.Element {
  const variables = useDashboardStore((s) => s.dashboard.variables) ?? []
  const [watchDraft, setWatchDraft] = useState('')

  const missingFromWatch = useMemo(
    () => referencedVariables(rule.condition).filter((name) => !rule.watch.includes(name)),
    [rule.condition, rule.watch]
  )

  function addWatch(name: string): void {
    const trimmed = name.trim()
    if (!trimmed || rule.watch.includes(trimmed)) return
    onChange({ watch: [...rule.watch, trimmed] })
  }

  return (
    <div className="global-actions-modal__editor">
      <label className="properties__field">
        <span>Name</span>
        <input value={rule.name} onChange={(e) => onChange({ name: e.target.value })} />
      </label>

      <label className="properties__field properties__field--inline">
        <input type="checkbox" checked={rule.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
        <span>Enabled</span>
      </label>

      <div className="properties__field">
        <span>Runs when these change</span>
        <div className="global-actions-modal__watch">
          {rule.watch.map((name) => (
            <span key={name} className="global-actions-modal__chip">
              {name}
              <button
                type="button"
                title={`Stop watching ${name}`}
                onClick={() => onChange({ watch: rule.watch.filter((w) => w !== name) })}
              >
                ×
              </button>
            </span>
          ))}
          {rule.watch.length === 0 && <span className="properties__hint">Nothing yet — this rule will never fire.</span>}
        </div>
        <div className="global-actions-modal__watch-add">
          {/* autoComplete="off" stops Chromium treating this as a fillable
              form field and repainting it with its own pale autofill
              background the moment a datalist suggestion is picked — the
              datalist itself is a separate mechanism and still works. See
              also the -webkit-autofill override in styles.css, which covers
              the cases Chromium ignores this attribute in. */}
          <input
            list="global-actions-variable-names"
            autoComplete="off"
            placeholder="Add a variable…"
            value={watchDraft}
            onChange={(e) => setWatchDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              addWatch(watchDraft)
              setWatchDraft('')
            }}
          />
          <button
            type="button"
            className="properties__file-button"
            disabled={!watchDraft.trim()}
            onClick={() => {
              addWatch(watchDraft)
              setWatchDraft('')
            }}
          >
            Add
          </button>
        </div>
        {/* Shared by the input above — a plain suggestion list, so a variable
            that doesn't exist yet (one a plugin will create on its first
            tick) can still be typed in by hand. */}
        <datalist id="global-actions-variable-names">
          {variables.map((v) => (
            <option key={v.id} value={v.name} />
          ))}
        </datalist>
      </div>

      <p className="properties__hint">
        The rule only re-checks when one of these variables changes, so a deck fed by a fast event source doesn&rsquo;t re-run every
        rule on every update.
      </p>

      {missingFromWatch.length > 0 && (
        <div className="global-actions-modal__warning">
          <span>
            The condition reads{' '}
            {missingFromWatch.map((name, i) => (
              <span key={name}>
                {i > 0 && ', '}
                <code>{name}</code>
              </span>
            ))}
            , which {missingFromWatch.length === 1 ? 'is' : 'are'} not in the list above — a change to{' '}
            {missingFromWatch.length === 1 ? 'it' : 'them'} won&rsquo;t re-check this rule.
          </span>
          <button type="button" className="properties__file-button" onClick={() => onChange({ watch: [...rule.watch, ...missingFromWatch] })}>
            Add {missingFromWatch.length === 1 ? 'it' : 'them'}
          </button>
        </div>
      )}

      <ExpressionField
        label="Condition"
        value={rule.condition}
        onChange={(condition) => onChange({ condition })}
        placeholder="return variables.gear_handle === 1 && variables.airspeed > 250;"
        minimal={false}
      />
      <p className="properties__hint">
        JS function body — return a truthy/falsy value. <code>variables</code> holds every variable&rsquo;s current value.
      </p>

      <label className="properties__field properties__field--inline">
        <span>Fire</span>
        <select value={rule.trigger} onChange={(e) => onChange({ trigger: e.target.value as GlobalAction['trigger'] })}>
          <option value="change">When the condition becomes true</option>
          <option value="always">Every time a watched variable changes</option>
        </select>
      </label>
      <p className="properties__hint">
        {rule.trigger === 'change'
          ? 'Fires once when the condition flips from false to true, and re-arms when it goes back to false.'
          : 'Fires on every change to a watched variable, for as long as the condition is true.'}
      </p>

      <EventSequenceEditor
        title="Actions"
        steps={rule.steps}
        onChange={(steps) => onChange({ steps })}
        dcsBiosActionEnabled={dcsBiosActionEnabled}
        hint="Runs in the main app, not on a connected device — so these fire whether or not anyone has the deck open."
      />
    </div>
  )
}

export function GlobalActionsModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const globalActions = useDashboardStore((s) => s.dashboard.globalActions) ?? []
  const updateDashboardMeta = useDashboardStore((s) => s.updateDashboardMeta)
  const confirm = useConfirmStore((s) => s.confirm)
  useEscapeToClose(onClose)

  const [selectedId, setSelectedId] = useState<string | null>(globalActions[0]?.id ?? null)

  // Same "fetch once if null" shape PropertiesPanel uses for its own copy of
  // this — the modal can be the first thing opened in a session, so it can't
  // rely on the properties panel having already populated it.
  const enabledPlugins = useDashboardStore((s) => s.enabledPlugins)
  const requestAppSettings = useDashboardStore((s) => s.requestAppSettings)
  useEffect(() => {
    if (enabledPlugins === null) requestAppSettings()
  }, [enabledPlugins, requestAppSettings])
  const dcsBiosActionEnabled = enabledPlugins === null || enabledPlugins.includes('dcsbios')

  // Populates ActionFields' own restWebhookTargets selector — same
  // connected-guarded fetch, and for the same reason, as PropertiesPanel's
  // own (see its comment there).
  const connected = useDashboardStore((s) => s.connected)
  const requestRestWebhookTargets = useDashboardStore((s) => s.requestRestWebhookTargets)
  useEffect(() => {
    if (connected) requestRestWebhookTargets()
  }, [connected, requestRestWebhookTargets])

  const selected = globalActions.find((r) => r.id === selectedId) ?? null

  function patchRule(id: string, fields: Partial<GlobalAction>): void {
    updateDashboardMeta({ globalActions: globalActions.map((r) => (r.id === id ? { ...r, ...fields } : r)) })
  }

  function addRule(): void {
    const rule: GlobalAction = {
      id: nextId(),
      name: `Rule ${globalActions.length + 1}`,
      enabled: true,
      watch: [],
      condition: '',
      trigger: 'change',
      steps: []
    }
    updateDashboardMeta({ globalActions: [...globalActions, rule] })
    setSelectedId(rule.id)
  }

  async function removeRule(id: string): Promise<void> {
    const ok = await confirm('Delete this global action? This cannot be undone.', { confirmLabel: 'Delete' })
    if (!ok) return
    const remaining = globalActions.filter((r) => r.id !== id)
    updateDashboardMeta({ globalActions: remaining })
    if (selectedId === id) setSelectedId(remaining[0]?.id ?? null)
  }

  // List order is evaluation order (see Dashboard.globalActions), so this is
  // a real behavioral control, not just cosmetic sorting.
  function moveRule(index: number, delta: number): void {
    const target = index + delta
    if (target < 0 || target >= globalActions.length) return
    const reordered = [...globalActions]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(target, 0, moved)
    updateDashboardMeta({ globalActions: reordered })
  }

  return (
    <div className="variables-modal-overlay" onPointerDown={onClose}>
      <div className="global-actions-modal" onPointerDown={(e) => e.stopPropagation()}>
        <div className="variables-modal__header">
          <h2 className="variables-modal__title">Global Actions</h2>
          <button type="button" className="modal-close" title="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="global-actions-modal__body">
          <div className="global-actions-modal__list">
            <p className="properties__hint">
              Deck-wide if/then rules. They run in the main app whether or not a device has the deck open, in the order listed here.
            </p>
            {globalActions.length === 0 && <p className="properties__hint">No global actions yet.</p>}
            {globalActions.map((rule, index) => (
              <div
                key={rule.id}
                className={`global-actions-modal__row${rule.id === selectedId ? ' global-actions-modal__row--active' : ''}${
                  rule.enabled ? '' : ' global-actions-modal__row--disabled'
                }`}
              >
                <button type="button" className="global-actions-modal__row-name" onClick={() => setSelectedId(rule.id)}>
                  {rule.name || '(unnamed)'}
                </button>
                <button type="button" title="Move up" disabled={index === 0} onClick={() => moveRule(index, -1)}>
                  ↑
                </button>
                <button type="button" title="Move down" disabled={index === globalActions.length - 1} onClick={() => moveRule(index, 1)}>
                  ↓
                </button>
                <button type="button" className="variables-modal__remove" title="Delete rule" onClick={() => void removeRule(rule.id)}>
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="properties__file-button" onClick={addRule}>
              + Add global action
            </button>
          </div>

          <div className="global-actions-modal__detail">
            {selected ? (
              <RuleEditor rule={selected} onChange={(fields) => patchRule(selected.id, fields)} dcsBiosActionEnabled={dcsBiosActionEnabled} />
            ) : (
              <p className="properties__hint">Select a global action to edit it, or add one.</p>
            )}
          </div>
        </div>

        <div className="global-actions-modal__footer">
          <button type="button" className="device-modal__save" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
