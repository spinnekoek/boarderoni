import { useEffect, useRef, useState } from 'react'
import { CodeEditor } from './CodeEditor'
import { ExpressionEditorModal } from './ExpressionEditorModal'
import type { RestIncomingMapping } from '@shared/types'

// Kept to a single line deliberately, same reasoning as EventSourcesModal's own
// EXPR_PLACEHOLDER — CodeMirror's placeholder extension renders an embedded
// "\n" as a real second visual row.
const EXPR_PLACEHOLDER = 'return variables.$value;'

// One incoming mapping row — same fx → inline panel → expand-to-modal
// interaction as EventSourcesModal.tsx's own MappingRow (reusing its exact CSS
// classes), except `field` is a free-text dot/index path (see
// shared/flattenJson.ts) rather than a `<select>` over a static/catalog
// field list, since a REST body has no fixed field set. Used only by
// RestDataSourcesSettingsPanel (incoming-only, see that file's own
// comment on the split from RestWebhookTargetsSettingsPanel).
export function RestMappingRow({
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
