import { useEffect, useRef, useState } from 'react'
import { COLOR_PALETTE } from '@shared/color'
import { HsvColorPicker } from './HsvColorPicker'
import { OpacityField } from './OpacityField'
import { CodeEditor } from './CodeEditor'
import { ExpressionEditorModal } from './ExpressionEditorModal'

const EXPR_PLACEHOLDER = "return variables.my_color;\n// or: return { color: '#ff0000', opacity: 70 }"

// Single-button color field. Two faces, both toggled by clicking the same
// trigger:
//  - static color: shows the current color as a swatch; opens a menu of
//    common colors + a custom HSV picker. A small "fx" button next to it
//    switches to expression mode.
//  - expression: shows an "fx" indicator; opens the expression code editor
//    instead. A small "x" next to the trigger drops back to a static color.
export function ColorPickerButton({
  value,
  onChange,
  isExpr = false,
  exprValue = '',
  onExprChange,
  onEnterExpr,
  onClearExpr,
  opacity,
  onOpacityChange,
  auto = false,
  onAuto
}: {
  value: string
  onChange: (color: string) => void
  isExpr?: boolean
  // The expression source — only read while isExpr is true.
  exprValue?: string
  onExprChange?: (code: string) => void
  // Omit to hide the "fx" button entirely (fields with no expression mode
  // of their own).
  onEnterExpr?: () => void
  // Omit to hide the "x" clear button (same condition as onEnterExpr, in
  // practice — both come from a field that supports expressions at all).
  onClearExpr?: () => void
  // Omit both to hide the opacity slider entirely (fields with no opacity
  // of their own, e.g. border color).
  opacity?: number
  onOpacityChange?: (value: number) => void
  // True when `value` is a computed fallback (e.g. auto-derived border
  // color) rather than an explicit choice — no swatch renders as selected
  // in that case, matching the old ColorPicker's `auto` prop. Omit onAuto
  // to hide the "Auto" button entirely (fields with no auto mode, e.g. the
  // plain background color field).
  auto?: boolean
  onAuto?: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Remembers the last non-empty expression text across on/off toggles —
  // onClearExpr clears colorExpr (etc.) to undefined in the actual widget
  // data, which would otherwise lose whatever was typed the moment you turn
  // expressions off. This is deliberately just component-local (not synced
  // to the widget), reset by the parent passing a fresh `key` per
  // widget/state/label so switching what you're editing doesn't leak one
  // field's draft into another's.
  const draftRef = useRef(exprValue)
  useEffect(() => {
    if (exprValue) draftRef.current = exprValue
  }, [exprValue])

  // Same capture-phase pointerdown + Escape pattern as ContextMenu.tsx —
  // except in expression mode, where the panel is inline (not a floating
  // popover) and is meant to stay open while you click around elsewhere
  // (other properties fields, the canvas) to keep editing the expression
  // against what you're seeing change. Only the trigger/clear buttons (and
  // Escape) close it in that case.
  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: PointerEvent): void {
      if (isExpr) return
      if (rootRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, isExpr])

  return (
    <div className="color-picker-button" ref={rootRef}>
      <div className="color-picker-button__row">
        <button
          type="button"
          className={`color-picker-button__trigger${isExpr ? ' color-picker-button__trigger--expr' : ''}`}
          style={{ backgroundColor: isExpr ? undefined : value }}
          onClick={() => setOpen((o) => !o)}
          title={isExpr ? 'Driven by an expression — click to edit' : value}
        >
          {isExpr && 'ƒx'}
        </button>
        {onAuto && (
          <button
            type="button"
            className={`color-picker-row__auto${auto ? ' color-picker-row__auto--active' : ''}`}
            // Disabled once there's real expression text to protect — Auto
            // clears colorExpr too (see onAuto in PropertiesPanel.tsx), so
            // clicking it here would silently discard whatever's typed.
            // Empty text (just entered expression mode, nothing written
            // yet) has nothing worth protecting, so it stays enabled then.
            disabled={isExpr && exprValue.trim() !== ''}
            title={isExpr && exprValue.trim() !== '' ? 'Clear the expression first (×) to use Auto' : undefined}
            // A real toggle: off, it clears to auto. Already auto, clicking
            // it again has to DO something observable too — snap to an
            // explicit color starting from whatever auto currently shows
            // (via onChange, not onAuto), so nothing visually jumps at the
            // moment of the click; it's just now a concrete, editable value
            // instead of a computed one.
            onClick={() => (auto ? onChange(value) : onAuto())}
          >
            Auto
          </button>
        )}
        {isExpr
          ? onClearExpr && (
              <button
                type="button"
                className="color-picker-button__clear"
                title="Remove expression"
                onClick={() => {
                  onClearExpr()
                  setOpen(false)
                }}
              >
                ×
              </button>
            )
          : onEnterExpr && (
              <button
                type="button"
                className="color-picker-button__fx"
                title={auto ? 'Pick a color first to use an expression' : 'Use an expression'}
                disabled={auto}
                onClick={() => {
                  // Restore whatever was last typed rather than starting
                  // from blank, if we remembered anything.
                  if (draftRef.current) onExprChange?.(draftRef.current)
                  else onEnterExpr()
                  setOpen(true)
                }}
              >
                ƒx
              </button>
            )}
      </div>

      {open &&
        (isExpr ? (
          // Inline, full-width panel — unlike the swatch/HSV menu below, this
          // isn't a floating popover, so it just pushes the fields after it
          // down the properties panel like any other field would.
          <div className="color-picker-button__expr-panel">
            {/* No opacity slider here — the expression can already return
                { color, opacity } to drive both, so a separate static slider
                next to it would be redundant (and misleading once the
                expression starts overriding it). */}
            <div className="color-picker-button__expr-editor-wrap">
              <CodeEditor value={exprValue} onChange={(code) => onExprChange?.(code)} placeholder={EXPR_PLACEHOLDER} minimal />
              <button
                type="button"
                className="color-picker-button__expand"
                title="Expand"
                onClick={() => setExpanded(true)}
              >
                ⤢
              </button>
            </div>
          </div>
        ) : (
          <div className="color-picker-button__menu">
            <div className="color-picker-button__swatches">
              {COLOR_PALETTE.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`color-picker__swatch${!auto && value.toLowerCase() === color.toLowerCase() ? ' color-picker__swatch--active' : ''}`}
                  style={{ backgroundColor: color }}
                  onClick={() => onChange(color)}
                  title={color}
                />
              ))}
            </div>
            <div className="color-picker-button__divider" />
            <HsvColorPicker value={value} onChange={onChange} />
            {onOpacityChange && opacity !== undefined && (
              <>
                <div className="color-picker-button__divider" />
                <OpacityField label="Opacity" value={opacity} onChange={onOpacityChange} />
              </>
            )}
          </div>
        ))}

      {expanded && (
        <ExpressionEditorModal
          value={exprValue}
          onChange={(code) => onExprChange?.(code)}
          placeholder={EXPR_PLACEHOLDER}
          onClose={() => setExpanded(false)}
        />
      )}
    </div>
  )
}
