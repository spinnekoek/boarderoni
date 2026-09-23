import { DEFAULT_WIDGET_COLOR, pickAutoBorderColor, withOpacity } from '@shared/color'
import { resolveBorderColor, resolveColor, resolveGlowColor, resolveNumericExpr, type VariableMap } from '@shared/expr'
import type { ButtonWidget, WidgetState } from '@shared/types'
import { actionTitle } from '@shared/actionTitle'
import { useEditorSettings } from '../../settingsStore'
import { renderWidgetLabels } from './labels'
import { boxStyle } from './boxStyle'

export function ButtonWidgetContent({
  widget,
  state,
  interactive,
  error,
  variables,
  onKeyboardActivate,
  applyRotation = true
}: {
  widget: ButtonWidget
  state: WidgetState
  interactive: boolean
  error?: string
  variables: VariableMap
  // The real trigger fires on pointerdown/pointerup (see ViewCanvas.tsx's
  // press()/release()), not this onClick — this only covers keyboard/
  // assistive-tech activation, which dispatches a synthetic click with no
  // pointer events at all. Guarded by e.detail === 0 (see the onClick
  // handler below) so a real pointer/touch click doesn't also fire this and
  // double-trigger.
  onKeyboardActivate?: () => void
  // The editor (CanvasWidget.tsx) rotates its own outer selection/resize box
  // to match instead of leaving it axis-aligned around a visually rotated
  // widget (see LineWidgetContent's identical applyRotation for the original
  // version of this), so it passes false here and applies the identical
  // angle up there itself, rather than this component rotating AGAIN inside
  // an already-rotated wrapper. The deployed view (ViewCanvas.tsx) has no
  // such box to keep in sync, so it leaves this at the default.
  applyRotation?: boolean
}): React.JSX.Element {
  const debugMode = useEditorSettings((s) => s.debugMode)
  const resolvedColor = resolveColor(state, variables)
  const backgroundColor = resolvedColor.color ?? DEFAULT_WIDGET_COLOR
  const resolvedBorderColor = resolveBorderColor(state, variables)
  const borderColor = resolvedBorderColor.color ?? pickAutoBorderColor(backgroundColor)
  // resolveGlowColor itself already resolves to box.glowColor when no
  // expression is set, and to nothing (not a stale glowColor) when an
  // expression is set but returns something that isn't a color — see its
  // own comment for why glow doesn't get resolveColor/resolveBorderColor's
  // usual expression-failure rescue.
  const resolvedGlow = resolveGlowColor(state, variables)
  const glowColor = resolvedGlow.color
  const rotateAngle = widget.rotateAngleExpr ? (resolveNumericExpr(widget.rotateAngleExpr, variables) ?? widget.rotateAngle) : widget.rotateAngle

  const buttonStyle: React.CSSProperties = {
    ...boxStyle(state),
    backgroundColor: withOpacity(backgroundColor, resolvedColor.opacity ?? state.backgroundOpacity ?? 1),
    borderColor: withOpacity(borderColor, resolvedBorderColor.opacity ?? state.borderOpacity ?? 1),
    // Left unset, this stays 'auto' (CSS default) and the widget falls back
    // to plain paint order (see bringToFront/sendToBack in store.ts) —
    // explicit z-index here overrides that per-state, e.g. to pop a
    // "Clicked" state above whatever it's overlapping while held.
    ...(state.zIndex !== undefined && { zIndex: state.zIndex }),
    transform: applyRotation && rotateAngle ? `rotate(${rotateAngle}deg)` : undefined,
    // Off entirely (no shadow) until there's an actual color to show — see
    // WidgetState.glowColor's own comment. Fixed blur/spread rather than
    // configurable, same "one deliberate look, not a knob for every
    // possible variant" scope this was asked for.
    ...(glowColor !== undefined && {
      boxShadow: `0 0 16px 3px ${withOpacity(glowColor, resolvedGlow.opacity ?? state.glowOpacity ?? 1)}`
    })
  }

  const labelElements = renderWidgetLabels(state.labels, backgroundColor, variables, debugMode)

  if (interactive) {
    return (
      <button
        className="deck-button"
        style={buttonStyle}
        onClick={(e) => {
          if (e.detail === 0) onKeyboardActivate?.()
        }}
        title={actionTitle(widget)}
      >
        {labelElements}
        {error && <span className="deck-button__error">{error}</span>}
      </button>
    )
  }

  return (
    <div className="deck-button deck-button--static" style={buttonStyle}>
      {labelElements}
    </div>
  )
}
