import { useState } from 'react'
import { CodeEditor } from './CodeEditor'
import { ExpressionEditorModal } from './ExpressionEditorModal'

// One labelled expression field: a CodeEditor plus the ⤢ expand-to-modal
// affordance. Every fx/expression field in the app goes through this, so the
// expand button is standard rather than something each call site remembers
// to add — it was previously hand-rolled at each of about a dozen sites and
// silently missing from several others (the update-state action's Code, a
// condition step's Condition, Set Windows Audio's volumeExpr, and the Global
// Actions condition), which is exactly the drift this exists to stop.
//
// Lives in its own module rather than in PropertiesPanel.tsx because
// GlobalActionsModal and the settings panels need it too, and it's a generic
// primitive that belongs beside CodeEditor rather than inside the widget
// properties panel.
export function ExpressionField({
  label,
  value,
  onChange,
  placeholder,
  // Drops the line-number gutter, which is noise on a one-line expression
  // but genuinely useful on a multi-line action body — hence the opt-out for
  // update-state code and condition steps, which are routinely several lines.
  minimal = true
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  minimal?: boolean
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  return (
    <>
      {/* A div, not a <label> — CodeEditor nests its own focusable input, and
          a wrapping <label> would synthesize a second click on the field's
          first labelable descendant every time you clicked into the editor.
          See VisibleField in PropertiesPanel.tsx, which hit exactly this. */}
      <div className="properties__field">
        <span>{label}</span>
        <div className="color-picker-button__expr-editor-wrap">
          <CodeEditor value={value} onChange={onChange} placeholder={placeholder} minimal={minimal} />
          <button type="button" className="color-picker-button__expand" title="Expand" onClick={() => setExpanded(true)}>
            ⤢
          </button>
        </div>
      </div>
      {expanded && <ExpressionEditorModal value={value} onChange={onChange} placeholder={placeholder} onClose={() => setExpanded(false)} />}
    </>
  )
}
