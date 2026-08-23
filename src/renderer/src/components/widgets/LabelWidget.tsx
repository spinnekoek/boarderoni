import { DEFAULT_WIDGET_COLOR } from '@shared/color'
import type { VariableMap } from '@shared/expr'
import type { LabelWidget } from '@shared/types'
import { useEditorSettings } from '../../settingsStore'
import { renderWidgetLabel } from './labels'

// The whole widget IS the label — no track/fill of its own, so there's
// nothing meaningful to pass renderWidgetLabel as the "what's behind this"
// background hint it uses for Auto text color (see resolveTextColor in
// shared/expr.ts). DEFAULT_WIDGET_COLOR (dark) is a reasonable stand-in
// given this app's own dark theme, same fallback every other widget's own
// track/fill already resolves to when unset.
export function LabelWidgetContent({ widget, variables }: { widget: LabelWidget; variables: VariableMap }): React.JSX.Element {
  const debugMode = useEditorSettings((s) => s.debugMode)
  return (
    <div className="deck-label" style={widget.zIndex !== undefined ? { zIndex: widget.zIndex } : undefined}>
      {renderWidgetLabel(widget.label, DEFAULT_WIDGET_COLOR, variables, debugMode)}
    </div>
  )
}
