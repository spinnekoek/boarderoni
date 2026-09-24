import { DEFAULT_WIDGET_COLOR, lighten, pickAutoBorderColor, withOpacity } from '@shared/color'
import { AUTO_CLICKED_LIGHTEN } from '@shared/constants'
import { resolveColor, type VariableMap } from '@shared/expr'
import { actionTitle } from '@shared/actionTitle'
import { effectiveBlockAppearance, effectiveBlockColor, isMorphSliderActive, morphSliderPointAtFraction, morphSliderPoints } from '@shared/morph'
import type { MorphBlock, MorphButtonWidget, WidgetState } from '@shared/types'
import { useEditorSettings } from '../../settingsStore'
import { renderWidgetLabels } from './labels'
import { boxStyle } from './boxStyle'

const SLIDER_HANDLE_RADIUS = 10

export function MorphButtonWidgetContent({
  widget,
  state,
  interactive,
  error,
  variables,
  onPress,
  onRelease,
  selectedBlockId,
  onCellPointerDown,
  onCellPointerMove,
  onCellPointerUp,
  onCellContextMenu,
  onBlockSelect,
  sliderFraction,
  onSliderPointerDown,
  onSliderPointerMove,
  onSliderPointerUp
}: {
  widget: MorphButtonWidget
  state: WidgetState
  interactive: boolean
  error?: string
  variables: VariableMap
  // onPress/onRelease double as the real server triggers (see
  // ClientCanvas.tsx's TriggerableClientWidget) — the per-block onClick below
  // fires both back to back only for keyboard/assistive-tech activation
  // (e.detail === 0, a synthetic click with no pointer events), matching
  // ButtonWidget.tsx's own onKeyboardActivate reasoning.
  onPress?: () => void
  onRelease?: () => void
  // Editor-only: highlights whichever block the properties panel's
  // spacing/radius/border sub-panel currently targets.
  selectedBlockId?: string | null
  // Editor-only (non-interactive) selection/drag handlers for the whole
  // widget — attached per block rather than to one bounding-box wrapper, so
  // an empty notch cell never steals a click meant for some other widget
  // placed behind it.
  onCellPointerDown?: (e: React.PointerEvent) => void
  onCellPointerMove?: (e: React.PointerEvent) => void
  onCellPointerUp?: (e: React.PointerEvent) => void
  onCellContextMenu?: (e: React.MouseEvent) => void
  // Fires alongside onCellPointerDown to pick which block the sub-panel
  // targets — separate from widget selection, which onCellPointerDown
  // already handles via useWidgetDrag.
  onBlockSelect?: (block: MorphBlock) => void
  // Owner-supplied, same "presentational, caller owns drag state" split
  // AdjusterWidgetContent uses (see useAdjusterDrag.ts/useMorphSliderDrag.ts)
  // — 0..1 handle position along the slider path. Undefined (no slider, or
  // isMorphSliderActive is false) simply skips rendering it. The three
  // pointer handlers are interactive-only (client, via
  // useMorphSliderDrag) — the editor preview passes sliderFraction alone,
  // with no drag handlers, to show a static rest position.
  sliderFraction?: number
  onSliderPointerDown?: (e: React.PointerEvent<SVGCircleElement>) => void
  onSliderPointerMove?: (e: React.PointerEvent<SVGCircleElement>) => void
  onSliderPointerUp?: (e: React.PointerEvent<SVGCircleElement>) => void
}): React.JSX.Element {
  const debugMode = useEditorSettings((s) => s.debugMode)
  // Shared fallback used for the label layer (which isn't per-block) and by
  // any block that doesn't override its own color — see effectiveBlockColor.
  const backgroundColor = resolveColor(state, variables).color ?? DEFAULT_WIDGET_COLOR

  // A "Clicked" look with states disabled is auto-derived (see
  // deriveClickedState in shared/states.ts) as a synthetic WidgetState whose
  // id never matches any block's perState key — every block's own
  // spacing/radius/border/color override would silently fall through to the
  // (unconfigured, per-block) widget-level default otherwise. Only a real,
  // per-widget "Clicked" state (statesEnabled on) has actual perState
  // entries worth looking up; the synthetic one falls back to the real
  // Default state for lookups, with just the color lightened per block.
  const isAutoClicked = !widget.statesEnabled && (state.isClicked ?? false)
  const lookupState = isAutoClicked ? widget.states[0] : state

  const cols = widget.blocks.map((b) => b.col)
  const rows = widget.blocks.map((b) => b.row)
  const minCol = Math.min(...cols)
  const minRow = Math.min(...rows)
  const totalCols = Math.max(...cols) - minCol + 1
  const totalRows = Math.max(...rows) - minRow + 1

  const blockElements = widget.blocks.map((block) => {
    const appearance = effectiveBlockAppearance(widget.blocks, block, lookupState.id)
    const color = effectiveBlockColor(block, lookupState, variables)
    const restingColor = color.color ?? DEFAULT_WIDGET_COLOR
    const blockBackgroundColor = isAutoClicked ? lighten(restingColor, AUTO_CLICKED_LIGHTEN) : restingColor
    const blockBorderColor = color.borderColor ?? pickAutoBorderColor(blockBackgroundColor)
    const cellStyle: React.CSSProperties = {
      ...boxStyle(appearance),
      backgroundColor: withOpacity(blockBackgroundColor, color.backgroundOpacity ?? 1),
      borderColor: withOpacity(blockBorderColor, color.borderOpacity ?? 1)
    }

    const slotStyle: React.CSSProperties = {
      position: 'absolute',
      left: (block.col - minCol) * widget.cellW,
      top: (block.row - minRow) * widget.cellH,
      width: widget.cellW,
      height: widget.cellH
    }

    if (interactive) {
      return (
        <div key={block.id} style={slotStyle}>
          <button
            className="deck-morph-cell"
            style={cellStyle}
            title={actionTitle(widget)}
            onClick={(e) => {
              if (e.detail === 0) {
                onPress?.()
                onRelease?.()
              }
            }}
            onPointerDown={(e) => {
              onPress?.()
              try {
                e.currentTarget.setPointerCapture(e.pointerId)
              } catch {
                // best-effort, see CanvasWidget's handlePointerDown
              }
            }}
            onPointerUp={() => onRelease?.()}
            onPointerCancel={() => onRelease?.()}
            onPointerLeave={() => onRelease?.()}
          />
        </div>
      )
    }

    return (
      <div key={block.id} style={slotStyle}>
        <div
          className={`deck-morph-cell deck-morph-cell--static${block.id === selectedBlockId ? ' deck-morph-cell--selected' : ''}`}
          style={cellStyle}
          onPointerDown={(e) => {
            onCellPointerDown?.(e)
            onBlockSelect?.(block)
          }}
          onPointerMove={onCellPointerMove}
          onPointerUp={onCellPointerUp}
          onContextMenu={onCellContextMenu}
        />
      </div>
    )
  })

  const labelElements = renderWidgetLabels(state.labels, backgroundColor, variables, debugMode)

  const width = totalCols * widget.cellW
  const height = totalRows * widget.cellH
  // sliderFraction is owner-supplied (see the prop comment above) — even
  // when isMorphSliderActive(widget), a caller that hasn't computed a
  // fraction yet (there isn't one, currently) just doesn't render anything
  // here, rather than assuming 0.
  const sliderPoints = isMorphSliderActive(widget) && sliderFraction !== undefined ? morphSliderPoints(widget) : null
  const sliderHandlePoint = sliderPoints ? morphSliderPointAtFraction(sliderPoints, sliderFraction!) : null

  return (
    <div className="deck-morph" style={{ width, height }}>
      {blockElements}
      <div className="deck-morph-labels">{labelElements}</div>
      {sliderPoints && sliderHandlePoint && (
        // Rendered as a later DOM sibling of blockElements above (not
        // nested inside any one block), so it always paints on top without
        // needing z-index — and a pointer hitting the handle is hit-tested
        // to the circle alone, never bubbling sideways into whichever
        // block happens to sit underneath it. Only the handle itself
        // (pointer-events: auto) is draggable; the path line and the rest
        // of the SVG (pointer-events: none) let clicks fall through to the
        // blocks below, same as before this existed.
        <svg
          className="deck-morph-slider"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        >
          <polyline
            points={sliderPoints.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke={withOpacity(pickAutoBorderColor(backgroundColor), 0.6)}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle
            className="deck-morph-slider__handle"
            cx={sliderHandlePoint.x}
            cy={sliderHandlePoint.y}
            r={SLIDER_HANDLE_RADIUS}
            fill={backgroundColor}
            stroke={pickAutoBorderColor(backgroundColor)}
            strokeWidth={2}
            style={{ pointerEvents: interactive && onSliderPointerDown ? 'auto' : 'none', cursor: interactive ? 'grab' : undefined }}
            onPointerDown={onSliderPointerDown}
            onPointerMove={onSliderPointerMove}
            onPointerUp={onSliderPointerUp}
          />
        </svg>
      )}
      {error && <span className="deck-button__error">{error}</span>}
    </div>
  )
}
