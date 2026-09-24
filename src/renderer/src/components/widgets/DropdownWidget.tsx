import { DEFAULT_WIDGET_COLOR, pickAutoActiveColor, withOpacity } from '@shared/color'
import { dropdownAxis, dropdownSign } from '@shared/dropdownLayout'
import { resolveBorderColor, resolveColor, type VariableMap } from '@shared/expr'
import type { DropdownWidget } from '@shared/types'
import { useEditorSettings } from '../../settingsStore'
import { renderWidgetLabels } from './labels'

// Fixed regardless of how many positions there are — the expanded stack's
// draw order needs to sit above every other widget on the dashboard, not
// just whatever this widget's own configured zIndex says (that's for
// resting stacking order, not "currently mid-interaction").
const OPEN_Z_INDEX = 9999

// Shared between the editor preview (CanvasWidget, interactive=false, always
// collapsed — there's no hold gesture to simulate there) and the
// client (ClientCanvas, interactive=true — see ClientDropdown, which wires
// useDropdownDrag's held/dragIndex/pointer handlers). Collapsed (either
// mode) shows only the active position, filling the widget's own x/y/w/h.
// Held shows every position, at a list-order slot per widget.expandMode:
//   - 'anchored' (default): each position's slot is (index - activeIndex)
//     — the active one never visually moves, the rest fan out around it
//     (see useDropdownDrag.ts's resolveIndex, which is the exact inverse of
//     this offset math).
//   - 'unanchored': each position's slot is just `index` — position 0
//     always fills the widget's own footprint and the rest stack after it
//     in list order, regardless of which one is active; the active one is
//     just highlighted wherever it falls.
// That slot then becomes a pixel offset via widget.orientation (see
// shared/dropdownLayout.ts) — which axis (left/top vs width/height) and
// which physical direction increasing slots move in.
export function DropdownWidgetContent({
  widget,
  variables,
  interactive,
  activeIndex,
  held,
  dragIndex,
  onPointerDown,
  onPointerMove,
  onPointerUp
}: {
  widget: DropdownWidget
  variables: VariableMap
  interactive: boolean
  activeIndex: number
  // Editor preview never holds — always collapsed.
  held?: boolean
  dragIndex?: number | null
  onPointerDown?: (e: React.PointerEvent) => void
  onPointerMove?: (e: React.PointerEvent) => void
  onPointerUp?: (e: React.PointerEvent) => void
}): React.JSX.Element {
  const debugMode = useEditorSettings((s) => s.debugMode)
  const resolvedTrack = resolveColor(widget.track, variables)
  const trackColor = withOpacity(resolvedTrack.color ?? DEFAULT_WIDGET_COLOR, resolvedTrack.opacity ?? widget.track.backgroundOpacity ?? 1)
  const resolvedBorder = resolveBorderColor(widget, variables)
  const borderColor = withOpacity(resolvedBorder.color ?? 'transparent', resolvedBorder.opacity ?? widget.borderOpacity ?? 1)
  const orientation = widget.orientation ?? 'top-to-bottom'
  const axis = dropdownAxis(orientation)
  const sign = dropdownSign(orientation)
  const anchored = (widget.expandMode ?? 'anchored') === 'anchored'
  const isOpen = interactive && (held ?? false)
  const itemSize = axis === 'horizontal' ? widget.w : widget.h
  const radius = `${widget.radiusTopLeft ?? 6}px ${widget.radiusTopRight ?? 6}px ${widget.radiusBottomRight ?? 6}px ${widget.radiusBottomLeft ?? 6}px`

  return (
    <div
      className={`deck-dropdown${interactive ? '' : ' deck-dropdown--static'}${isOpen ? ' deck-dropdown--open' : ''}`}
      // borderRadius matches the item's own below — this container's flat
      // trackColor background otherwise shows through as square corners
      // peeking past the collapsed item's rounded ones (the item exactly
      // covers this box when idle, but rounding only its own corners left
      // this box's corners showing underneath). Can't just clip this box
      // with overflow:hidden instead — see the CSS rule's own comment on
      // why held items need to render outside these bounds.
      style={{ background: trackColor, borderRadius: radius, zIndex: isOpen ? OPEN_Z_INDEX : widget.zIndex }}
      onPointerDown={interactive ? onPointerDown : undefined}
      onPointerMove={interactive ? onPointerMove : undefined}
      onPointerUp={interactive ? onPointerUp : undefined}
      onPointerCancel={interactive ? onPointerUp : undefined}
    >
      {(widget.positions ?? []).map((position, index) => {
        if (!isOpen && index !== activeIndex) return null
        const listSlot = anchored ? index - activeIndex : index
        const offset = !isOpen ? 0 : listSlot * sign * itemSize

        const resolvedColor = resolveColor(position, variables)
        const unselectedColor = resolvedColor.color ?? DEFAULT_WIDGET_COLOR
        // Collapsed, the one visible item always reads as "the current
        // pick" (its active look); held, only whichever one the drag is
        // currently over does — see useDropdownDrag's dragIndex.
        const highlighted = isOpen ? index === (dragIndex ?? activeIndex) : true
        let displayColor = unselectedColor
        let opacity = resolvedColor.opacity ?? position.backgroundOpacity ?? 1
        if (highlighted) {
          const resolvedActive = resolveColor({ color: position.activeColor, colorExpr: position.activeColorExpr }, variables)
          displayColor = resolvedActive.color ?? pickAutoActiveColor(unselectedColor)
          opacity = resolvedActive.opacity ?? position.activeOpacity ?? opacity
        }
        const itemColor = withOpacity(displayColor, opacity)

        return (
          <div
            key={position.id}
            className="deck-dropdown__item"
            style={{
              ...(axis === 'horizontal'
                ? { left: offset, top: 0, width: itemSize, height: '100%' }
                : { left: 0, top: offset, width: '100%', height: itemSize }),
              background: itemColor,
              borderRadius: radius,
              borderStyle: 'solid',
              borderTopWidth: widget.borderWidthTop ?? 1,
              borderRightWidth: widget.borderWidthRight ?? 1,
              borderBottomWidth: widget.borderWidthBottom ?? 1,
              borderLeftWidth: widget.borderWidthLeft ?? 1,
              borderColor
            }}
          >
            {renderWidgetLabels(position.labels, itemColor, variables, debugMode)}
          </div>
        )
      })}
    </div>
  )
}
