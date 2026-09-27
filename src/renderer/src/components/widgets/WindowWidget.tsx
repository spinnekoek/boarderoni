import { withOpacity } from '@shared/color'
import { resolveBorderColor, resolveExprColor, resolveNumericExpr, resolveWidgetVisible, type VariableMap } from '@shared/expr'
import { getEffectiveStates } from '@shared/states'
import { resolveActivePositionIndex } from '@shared/switchPosition'
import { morphFootprint } from '@shared/morph'
import type { Widget, WindowWidget } from '@shared/types'
import { useDashboardStore } from '../../store'
import { ButtonWidgetContent } from './ButtonWidget'
import { MorphButtonWidgetContent } from './MorphButtonWidget'
import { BarGaugeWidgetContent, ArcGaugeWidgetContent } from './GaugeWidget'
import { LabelWidgetContent } from './LabelWidget'
import { LineWidgetContent } from './LineWidget'
import { ScreenCaptureWidgetContent } from './ScreenCaptureWidget'
import { DcsViewportWidgetContent } from './DcsViewportWidget'
import { AdjusterWidgetContent } from './AdjusterWidget'
import { EncoderWidgetContent } from './EncoderWidget'
import { RockerSwitchWidgetContent } from './RockerSwitchWidget'
import { DialSwitchWidgetContent } from './DialSwitchWidget'
import { ToggleSwitchWidgetContent } from './ToggleSwitchWidget'
import { DropdownWidgetContent } from './DropdownWidget'

// Every widget type EXCEPT another window (see WindowWidget's own top
// comment in shared/types.ts: one level deep only, matching SubDeck's own
// precedent) renders inside a window's own nested content — but for v1,
// display-only: buttons/switches/adjusters/encoders/dropdowns show their
// current, fx-driven state correctly, just not clickable/draggable there
// yet (interactive={false} throughout, no press/drag hooks wired up for a
// clipped+panned+scaled nested coordinate space — real work, deliberately
// deferred rather than half-built into this first pass). Each stateful
// type's "which state/position is currently showing" is resolved the exact
// same way CanvasWidget.tsx's own non-interactive preview already does for
// an unselected widget on the main canvas.
function renderNestedWidget(widget: Widget, variables: VariableMap, deckId: string | null): React.ReactNode {
  if (!resolveWidgetVisible(widget, variables)) return null
  let content: React.ReactNode = null
  // A morph widget's own real bounding box isn't its plain x/y/w/h (it has
  // no such fields at all — see morphFootprint's own callers in
  // MorphCanvasWidget.tsx/ClientCanvas.tsx for the identical box/positioning
  // split every other renderer of a morph widget already has to make).
  const box: { x: number; y: number; w: number; h: number } = widget.type === 'morph' ? morphFootprint(widget) : widget
  switch (widget.type) {
    case 'label':
      content = <LabelWidgetContent widget={widget} variables={variables} />
      break
    case 'line':
      content = <LineWidgetContent widget={widget} variables={variables} />
      break
    case 'gauge-bar':
      content = <BarGaugeWidgetContent widget={widget} variables={variables} />
      break
    case 'gauge-arc':
      content = <ArcGaugeWidgetContent widget={widget} variables={variables} />
      break
    case 'screen-capture':
      content = <ScreenCaptureWidgetContent widget={widget} variables={variables} deckId={deckId} />
      break
    case 'dcs-viewport':
      content = <DcsViewportWidgetContent widget={widget} variables={variables} deckId={deckId} />
      break
    case 'adjuster-slider':
    case 'adjuster-knob':
      content = <AdjusterWidgetContent widget={widget} variables={variables} interactive={false} />
      break
    case 'encoder':
      content = <EncoderWidgetContent widget={widget} variables={variables} interactive={false} />
      break
    case 'button': {
      const state = getEffectiveStates(widget, variables)[0] ?? widget.states?.[0]
      if (!state) return null
      content = <ButtonWidgetContent widget={widget} state={state} interactive={false} variables={variables} applyRotation={false} />
      break
    }
    case 'morph': {
      const state = widget.states[0]
      if (!state) return null
      content = (
        <MorphButtonWidgetContent
          widget={widget}
          state={state}
          interactive={false}
          variables={variables}
          sliderFraction={widget.valueExpr ? (resolveNumericExpr(widget.valueExpr, variables) ?? 0) / 100 : 0}
          selectedBlockId={null}
          onCellPointerDown={() => {}}
          onCellPointerMove={() => {}}
          onCellPointerUp={() => {}}
        />
      )
      break
    }
    case 'switch-rocker':
      content = (
        <RockerSwitchWidgetContent
          widget={widget}
          variables={variables}
          interactive={false}
          activeIndex={resolveActivePositionIndex(widget.positions ?? [], widget.activePositionExpr, variables) ?? (widget.settleToInactive ? null : 0)}
          selectedPositionId={null}
          onPositionSelect={() => {}}
          applyRotation={false}
        />
      )
      break
    case 'switch-dial':
      content = (
        <DialSwitchWidgetContent
          widget={widget}
          variables={variables}
          interactive={false}
          activeIndex={resolveActivePositionIndex(widget.positions ?? [], widget.activePositionExpr, variables) ?? 0}
          applyRotation={false}
        />
      )
      break
    case 'switch-toggle':
      content = (
        <ToggleSwitchWidgetContent
          widget={widget}
          variables={variables}
          interactive={false}
          activeIndex={resolveActivePositionIndex(widget.positions ?? [], widget.activePositionExpr, variables) ?? 0}
          selectedPositionId={null}
          onPositionSelect={() => {}}
          applyRotation={false}
        />
      )
      break
    case 'dropdown':
      content = (
        <DropdownWidgetContent
          widget={widget}
          variables={variables}
          interactive={false}
          activeIndex={resolveActivePositionIndex(widget.positions ?? [], widget.activePositionExpr, variables) ?? 0}
        />
      )
      break
    default:
      return null
  }
  return (
    <div key={widget.id} style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h }}>
      {content}
    </div>
  )
}

// A fixed-size, styled viewport clipping and panning a much larger nested
// content area — see WindowWidget's own top comment in shared/types.ts for
// the full design (compass-tape motivating example, subDeckId reuse of the
// existing sub-deck storage/editing machinery, v1 interactivity scope).
// Shared as-is between the editor's own live preview (CanvasWidget.tsx) and
// the deployed client (ClientCanvas.tsx) — nested content here is always
// display-only regardless of caller, so there's no separate
// interactive/applyRotation split the way most other *WidgetContent
// components have.
export function WindowWidgetContent({ widget, variables, deckId }: { widget: WindowWidget; variables: VariableMap; deckId: string | null }): React.JSX.Element {
  const subDeck = useDashboardStore((s) => s.dashboard.subDecks?.find((sd) => sd.id === widget.subDeckId))
  const resolvedBackground = resolveExprColor(widget.backgroundColor, widget.backgroundColorExpr, variables)
  const backgroundColor = resolvedBackground.color ? withOpacity(resolvedBackground.color, resolvedBackground.opacity ?? widget.backgroundOpacity ?? 1) : 'transparent'
  const resolvedBorder = resolveBorderColor(widget, variables)
  const borderColor = withOpacity(resolvedBorder.color ?? 'transparent', resolvedBorder.opacity ?? widget.borderOpacity ?? 1)

  const offsetX = widget.contentOffsetXExpr ? (resolveNumericExpr(widget.contentOffsetXExpr, variables) ?? widget.contentOffsetX ?? 0) : (widget.contentOffsetX ?? 0)
  const offsetY = widget.contentOffsetYExpr ? (resolveNumericExpr(widget.contentOffsetYExpr, variables) ?? widget.contentOffsetY ?? 0) : (widget.contentOffsetY ?? 0)
  const scaleX = widget.contentScaleX ?? 1
  const scaleY = widget.contentScaleY ?? 1

  // Unset defaults to the window's OWN visible box, not the whole-deck
  // DEFAULT_CANVAS_WIDTH/HEIGHT (1920x1080) — a fresh window has nothing to
  // pan until its content is deliberately made bigger than the viewport
  // (via the canvas-size controls already shown while editing its own
  // sub-deck), so starting equal to the visible box means "no panning yet"
  // reads correctly rather than showing 1920x1080 of mostly-empty content.
  const contentWidth = subDeck?.canvasWidth ?? widget.w
  const contentHeight = subDeck?.canvasHeight ?? widget.h

  return (
    <div
      className="deck-window"
      style={{
        backgroundColor,
        borderRadius: `${widget.radiusTopLeft ?? 0}px ${widget.radiusTopRight ?? 0}px ${widget.radiusBottomRight ?? 0}px ${widget.radiusBottomLeft ?? 0}px`,
        borderStyle: 'solid',
        borderTopWidth: widget.borderWidthTop ?? 0,
        borderRightWidth: widget.borderWidthRight ?? 0,
        borderBottomWidth: widget.borderWidthBottom ?? 0,
        borderLeftWidth: widget.borderWidthLeft ?? 0,
        borderColor,
        ...(widget.zIndex !== undefined && { zIndex: widget.zIndex })
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: contentWidth,
          height: contentHeight,
          // Rounded to a whole pixel — an unrounded fractional translate
          // (e.g. a non-integer contentScaleX, or an expression that
          // doesn't happen to return a whole number) lands the ENTIRE
          // panned layer on a sub-pixel position, which blurs/anti-aliases
          // every hairline inside it (a 1px tick mark, say) across two
          // physical pixel rows — while anything positioned OUTSIDE this
          // transform (e.g. a fixed center-pointer marker widget) stays
          // crisp at its own integer position, so the two drift out of
          // alignment by up to half a pixel even though both are
          // authored as exactly 1px wide.
          transform: `translate(${Math.round(-offsetX * scaleX)}px, ${Math.round(-offsetY * scaleY)}px)`
        }}
      >
        {(subDeck?.widgets ?? []).map((w) => renderNestedWidget(w, variables, deckId))}
      </div>
    </div>
  )
}
