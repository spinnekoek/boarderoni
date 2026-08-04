import { useDashboardStore } from '../store'
import { nextId } from '../id'
import type { Variable, VariableValue } from '@shared/types'

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

export function VariablesModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const variables = useDashboardStore((s) => s.dashboard.variables) ?? []
  const updateDashboardMeta = useDashboardStore((s) => s.updateDashboardMeta)

  function patchVariable(id: string, fields: Partial<Variable>): void {
    updateDashboardMeta({ variables: variables.map((v) => (v.id === id ? { ...v, ...fields } : v)) })
  }

  function addVariable(): void {
    updateDashboardMeta({ variables: [...variables, { id: nextId(), name: 'new_variable', value: '' }] })
  }

  function removeVariable(id: string): void {
    updateDashboardMeta({ variables: variables.filter((v) => v.id !== id) })
  }

  return (
    <div className="variables-modal-overlay" onPointerDown={onClose}>
      <div className="variables-modal" onPointerDown={(e) => e.stopPropagation()}>
        <h2 className="variables-modal__title">Variables</h2>
        <p className="properties__hint">
          Referenced in expressions as <code>variables.&lt;name&gt;</code>. Set by any widget whose action is "Update state".
        </p>

        {variables.length === 0 && <p className="properties__hint">No variables yet.</p>}

        {variables.length > 0 && (
          <div className="variables-modal__list">
            <div className="variables-modal__row variables-modal__row--header">
              <span>Name</span>
              <span>Value</span>
              <span />
            </div>
            {variables.map((v) => (
              <div key={v.id} className="variables-modal__row">
                <input value={v.name} onChange={(e) => patchVariable(v.id, { name: e.target.value })} />
                <input
                  defaultValue={String(v.value)}
                  key={`${v.id}-${String(v.value)}`}
                  onBlur={(e) => patchVariable(v.id, { value: parseVariableValue(e.target.value) })}
                />
                <button type="button" className="variables-modal__remove" title="Delete variable" onClick={() => removeVariable(v.id)}>
                  ×
                </button>
              </div>
            ))}
          </div>
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
