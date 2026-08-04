import { DEFAULT_WIDGET_COLOR, lighten, pickAutoBorderColor, withOpacity } from '@shared/color'
import { AUTO_CLICKED_LIGHTEN } from '@shared/constants'
import { resolveColor, type VariableMap } from '@shared/expr'
import { actionTitle } from '@shared/actionTitle'
import { effectiveBlockAppearance, effectiveBlockColor } from '@shared/morph'
import type { MorphBlock, MorphButtonWidget, WidgetState } from '@shared/types'
import { renderWidgetLabels } from './labels'
import { boxStyle } from './boxStyle'

export function MorphButtonWidgetContent({
  widget,
  state,
  interactive,
  error,
  variables,
  onTrigger,
  onPress,
  onRelease,
  selectedBlockId,
  onCellPointerDown,
  onCellPointerMove,
  onCellPointerUp,
  onCellContextMenu,
  onBlockSelect
}: {
  widget: MorphButtonWidget
  state: WidgetState
  interactive: boolean
  error?: string
  variables: VariableMap
  onTrigger?: () => void
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
}): React.JSX.Element {
  // Shared fallback used for the label layer (which isn't per-block) and by
  // any block that doesn't override its own color — see effectiveBlockColor.
  const backgroundColor = resolveColor(state, variables) ?? DEFAULT_WIDGET_COLOR

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
            title={actionTitle(widget.action)}
            onClick={onTrigger}
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

  const labelElements = renderWidgetLabels(state.labels, backgroundColor, variables)

  return (
    <div className="deck-morph" style={{ width: totalCols * widget.cellW, height: totalRows * widget.cellH }}>
      {blockElements}
      <div className="deck-morph-labels">{labelElements}</div>
      {error && <span className="deck-button__error">{error}</span>}
    </div>
  )
}
