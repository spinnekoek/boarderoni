import { useEffect, useRef, useState } from 'react'
import { useDashboardStore } from '../store'
import { useEditorSettings } from '../settingsStore'
import { DEFAULT_FONT_ID } from '@shared/fonts'
import { DEFAULT_WIDGET_COLOR } from '@shared/color'
import { isWidgetTypeGatedByDisabledPlugin } from '@shared/plugins'
import { nextId } from '../id'
import type {
  AdjusterSliderWidget,
  AdjusterKnobWidget,
  ButtonWidget,
  DcsViewportWidget,
  DialSwitchWidget,
  DropdownWidget,
  EncoderWidget,
  BarGaugeWidget,
  ArcGaugeWidget,
  LabelWidget,
  LineWidget,
  MorphButtonWidget,
  RockerSwitchWidget,
  ScreenCaptureWidget,
  ToggleSwitchWidget,
  Widget
} from '@shared/types'

// A named, fully-preset alternative to a widget type's own plain default
// below — picked from the small chevron menu next to that widget's palette
// button instead of always getting the plain default. Toggle Switch is the
// first widget type to get one; more can grow their own variants list the
// same way later (see PaletteVariantButton, the shared UI for however many
// end up needing this).
interface WidgetVariant<W> {
  name: string
  build: (pos: { x: number; y: number }) => W
}

// A hex-bolt-guarded, 3-position (BRT/OFF/DIM) "STROBE" switch — a real
// aircraft-panel look, distinct from the plain Top/Bottom default below
// (that one came from a different, simpler Empty Wempty example toggle;
// this one replaced it once the deck's toggle was redone specifically to
// give this variant something to look like).
const TOGGLE_SWITCH_VARIANTS: WidgetVariant<ToggleSwitchWidget>[] = [
  {
    name: 'Aircraft Toggle',
    build: (pos) => ({
      id: nextId(),
      type: 'switch-toggle',
      x: pos.x,
      y: pos.y,
      w: 50,
      h: 50,
      orientation: 'vertical',
      positions: [
        {
          id: nextId(),
          name: 'Top',
          labels: [
            {
              id: nextId(),
              text: 'BRT',
              fontFamily: 'roboto',
              align: 'center',
              verticalAlign: 'center',
              fontSize: 10,
              padding: 0,
              textColor: '#a5a5a5',
              textOpacity: 1,
              labelDistance: 18
            }
          ],
          onSelect: [],
          momentary: false,
          color: '#2a2e37'
        },
        {
          id: nextId(),
          name: 'Middle',
          labels: [
            {
              id: nextId(),
              text: 'O␤F␤F',
              fontFamily: 'roboto',
              align: 'center',
              verticalAlign: 'center',
              fontSize: 10,
              padding: 0,
              textColor: '#a5a5a5',
              textAlign: 'center',
              labelDistance: 12
            }
          ],
          onSelect: []
        },
        {
          id: nextId(),
          name: 'Bottom',
          labels: [
            {
              id: nextId(),
              text: 'DIM',
              align: 'center',
              verticalAlign: 'center',
              fontSize: 10,
              textColor: '#a5a5a5',
              padding: 0,
              labelAnchor: 'bottom',
              labelDistance: 17,
              fontFamily: 'roboto'
            }
          ],
          onSelect: [],
          momentary: false
        }
      ],
      labels: [{ id: nextId(), text: 'STROBE', align: 'center', verticalAlign: 'top', fontSize: 12, padding: -20, fontFamily: 'roboto', rotation: 0 }],
      track: { color: '#14161b', backgroundOpacity: 0 },
      fill: { color: '#d3cfc5' },
      events: { press: [], release: [], positionChange: [], guardToggle: [] },
      borderColor: '#e8e8ea',
      leverLength: 34,
      barWidth: 69,
      barHeight: 23,
      barBorderWidth: 3,
      barBorderRadius: 7,
      bezelRadius: 30,
      leverBorderWidth: 6,
      barBorderColor: '#5e5a52',
      leverBorderColor: '#d3cfc5',
      innerBezelRadius: 14,
      innerBezelColor: '#ba1918',
      innerBezelBorderWidth: 3,
      innerBezelBorderColor: '#d9a219',
      interactionMode: 'drag',
      bezelShape: 'hexagon',
      bezelRotation: 0,
      fireWhileDragging: true,
      activePositionExpr:
        '// positions\nconst map = {\n  2: "Top",\n  1: "Middle",\n  0: "Bottom"\n};\n\nreturn map[variables.SOME_VARIABLE || 0];'
    })
  }
]

// A green-on-black digital radio-frequency readout — statesEnabled so
// Clicked can look different (see PropertiesPanel's own state tabs), but
// this variant only carries the one Default state that's actually set on
// the Empty Wempty source widget; a second, Clicked-specific look is
// whatever's added from there, same as any other statesEnabled button.
const BUTTON_VARIANTS: WidgetVariant<ButtonWidget>[] = [
  {
    name: 'Aircraft Display',
    build: (pos) => ({
      id: nextId(),
      type: 'button',
      x: pos.x,
      y: pos.y,
      w: 240,
      h: 60,
      statesEnabled: true,
      states: [
        {
          id: nextId(),
          name: 'Default',
          labels: [
            {
              id: nextId(),
              text: '124.800 MHz',
              fontFamily: 'jetbrainsMono',
              align: 'left',
              verticalAlign: 'center',
              fontSize: 31,
              padding: 13,
              textColor: '#56b728',
              textOpacity: 1
            }
          ],
          spacingTop: 0,
          radiusBottomLeft: 2,
          radiusTopLeft: 2,
          radiusTopRight: 2,
          radiusBottomRight: 2,
          borderColor: '#3e3e3e',
          borderWidthTop: 1,
          borderWidthLeft: 1,
          borderWidthRight: 1,
          borderWidthBottom: 1,
          color: '#061806',
          spacingLeft: 0,
          spacingBottom: 0,
          spacingRight: 0
        }
      ],
      labels: [{ id: nextId(), text: '' }],
      events: { press: [], release: [], doublePress: [], triplePress: [] }
    })
  }
]

// The main button (left) still adds the plain default on a direct click;
// the chevron (right) opens a dropdown of named variants instead. Closes on
// an outside pointerdown or Escape — same pattern as ContextMenu.tsx's own
// (capture-phase, so a widget's own stopPropagation-ing pointerdown handler
// elsewhere on the canvas still can't prevent this from seeing it). Generic
// over W since more than one widget type has variants now (Toggle Switch,
// Button) — each palette row instantiates this with its own widget type.
function PaletteVariantButton<W extends Widget>({
  label,
  onAddPlain,
  variants,
  onSelectVariant
}: {
  label: string
  onAddPlain: () => void
  variants: WidgetVariant<W>[]
  onSelectVariant: (variant: WidgetVariant<W>) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const groupRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: PointerEvent): void {
      if (groupRef.current?.contains(e.target as Node)) return
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
  }, [open])

  return (
    <div className="palette__item-group" ref={groupRef}>
      <button className="palette__item" onClick={onAddPlain}>
        {label}
      </button>
      <button type="button" className="palette__item-variant-toggle" title="Add a variant…" onClick={() => setOpen((o) => !o)}>
        ▾
      </button>
      {open && (
        <div className="palette__item-variant-menu">
          {variants.map((variant) => (
            <button
              key={variant.name}
              type="button"
              className="palette__item-variant-menu-item"
              onClick={() => {
                onSelectVariant(variant)
                setOpen(false)
              }}
            >
              {variant.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Palette(): React.JSX.Element {
  const addWidget = useDashboardStore((s) => s.addWidget)
  const selectWidget = useDashboardStore((s) => s.selectWidget)
  const camera = useEditorSettings((s) => s.camera)
  // null (not yet arrived — see main/index.ts's sendInitialState) reads as
  // enabled, same "don't flash a wrong state before the real one lands"
  // convention as ScreenCaptureWidgetContent's own pluginEnabled.
  const enabledPlugins = useDashboardStore((s) => s.enabledPlugins)
  const screenCaptureAvailable = enabledPlugins === null || !isWidgetTypeGatedByDisabledPlugin('screen-capture', enabledPlugins)
  // No widgetTypes entry for 'dcsViewports' (see shared/plugins/dcsViewports.ts)
  // — its widget also needs the virtual display to be ready, not just the
  // plugin toggle, which isWidgetTypeGatedByDisabledPlugin can't express. The
  // add button only checks the toggle, same bar as screenCaptureAvailable;
  // "not ready yet" shows as the widget's own placeholder once added (see
  // DcsViewportWidgetContent), not as a hidden palette button.
  const dcsViewportsAvailable = enabledPlugins === null || enabledPlugins.includes('dcsViewports')

  // Where a newly-added widget lands: just inside the canvas corner that's
  // currently visible, rather than a fixed board-origin spot that could be
  // panned/zoomed far off-screen. -camera.x/y is the world coordinate under
  // the viewport's own top-left corner (inverse of the canvas-layer's
  // translate+scale — see Canvas.tsx's screenToWorld for the same math), and
  // the +40 keeps it off the very edge, matching the old fixed inset.
  function spawnPosition(): { x: number; y: number } {
    return { x: -camera.x / camera.zoom + 40, y: -camera.y / camera.zoom + 40 }
  }

  function handleAddButton(): void {
    const pos = spawnPosition()
    const widget: ButtonWidget = {
      id: nextId(),
      type: 'button',
      x: pos.x,
      y: pos.y,
      w: 160,
      h: 80,
      events: { press: [], release: [], doublePress: [], triplePress: [] },
      statesEnabled: false,
      states: [
        {
          id: nextId(),
          name: 'Default',
          labels: [{ id: nextId(), text: 'New Button', fontFamily: DEFAULT_FONT_ID, align: 'center', verticalAlign: 'center' }]
        }
      ]
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  function handleAddButtonVariant(variant: WidgetVariant<ButtonWidget>): void {
    const widget = variant.build(spawnPosition())
    addWidget(widget)
    selectWidget(widget.id)
  }

  function handleAddMorph(): void {
    const pos = spawnPosition()
    const widget: MorphButtonWidget = {
      id: nextId(),
      type: 'morph',
      x: pos.x,
      y: pos.y,
      cellW: 40,
      cellH: 40,
      blocks: [
        { id: nextId(), col: 0, row: 0, perState: {} },
        { id: nextId(), col: 1, row: 0, perState: {} },
        { id: nextId(), col: 2, row: 0, perState: {} },
        { id: nextId(), col: 3, row: 0, perState: {} },
        { id: nextId(), col: 3, row: 1, perState: {} },
        { id: nextId(), col: 3, row: 2, perState: {} }
      ],
      events: { press: [], release: [] },
      statesEnabled: false,
      states: [
        {
          id: nextId(),
          name: 'Default',
          labels: [{ id: nextId(), text: 'New Morph', fontFamily: DEFAULT_FONT_ID, align: 'center', verticalAlign: 'center' }]
        }
      ]
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  function handleAddBarGauge(): void {
    const pos = spawnPosition()
    const widget: BarGaugeWidget = {
      id: nextId(),
      type: 'gauge-bar',
      x: pos.x,
      y: pos.y,
      w: 160,
      h: 40,
      valueExpr: 'const someValue = 34;\nreturn variables.my_variable || someValue;',
      min: 0,
      max: 100,
      orientation: 'horizontal',
      fill: { color: '#5b8def' },
      // Left unset, not DEFAULT_WIDGET_COLOR — GaugeWidgetContent's own
      // trackColor fallback already resolves to that same value (no visual
      // change here).
      track: {},
      labels: []
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  function handleAddArcGauge(): void {
    const pos = spawnPosition()
    const widget: ArcGaugeWidget = {
      id: nextId(),
      type: 'gauge-arc',
      x: pos.x,
      y: pos.y,
      w: 120,
      h: 120,
      valueExpr: 'const someValue = 34;\nreturn variables.my_variable || someValue;',
      min: 0,
      max: 100,
      fill: { color: '#5b8def' },
      track: { color: '#2a2e37' },
      labels: [],
      startAngle: 225,
      endAngle: 495,
      showIndicator: true
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  function handleAddSlider(): void {
    const pos = spawnPosition()
    const widget: AdjusterSliderWidget = {
      id: nextId(),
      type: 'adjuster-slider',
      x: pos.x,
      y: pos.y,
      w: 60,
      h: 160,
      orientation: 'vertical',
      min: 0,
      max: 100,
      events: { press: [], release: [], move: [], doublePress: [], triplePress: [] },
      fill: { color: '#5b8def' },
      track: { color: DEFAULT_WIDGET_COLOR },
      labels: [],
      valueExpr: 'const someValue = 34;\nreturn variables.my_variable || someValue;',
      handleShape: 'square',
      handleWidth: 32,
      handleHeight: 12,
      handleRadius: 3,
      handleColor: '#3a3f4a'
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  function handleAddKnob(): void {
    const pos = spawnPosition()
    const widget: AdjusterKnobWidget = {
      id: nextId(),
      type: 'adjuster-knob',
      x: pos.x,
      y: pos.y,
      w: 100,
      h: 100,
      min: 0,
      max: 100,
      events: { press: [], release: [], move: [], doublePress: [], triplePress: [] },
      fill: { color: '#5b8def' },
      track: { color: DEFAULT_WIDGET_COLOR },
      labels: [],
      valueExpr: 'const someValue = 34;\nreturn variables.my_variable || someValue;',
      dialShape: 'square',
      squareWidth: 22,
      squareHeight: 40,
      squareBorderRadius: 2,
      indicatorShape: 'triangle',
      indicatorStyle: { width: 22, height: 12, borderWidth: 0, borderRadius: 2 },
      indicatorDistance: 25,
      dialDistance: -3,
      startAngle: 225,
      endAngle: 495
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  function handleAddEncoder(): void {
    const pos = spawnPosition()
    const widget: EncoderWidget = {
      id: nextId(),
      type: 'encoder',
      x: pos.x,
      y: pos.y,
      w: 80,
      h: 80,
      stepDegrees: 15,
      events: { increment: [], decrement: [], press: [], release: [], doublePress: [], triplePress: [] },
      fill: { color: '#5b8def' },
      track: { color: DEFAULT_WIDGET_COLOR },
      labels: []
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  // Rocker-specific — Dial Switch and Dropdown each have their own dedicated
  // positions factory too (defaultDialSwitchPositions/defaultDropdownPositions),
  // not one shared function anymore. "On"/"Off" reads right for a rocker
  // specifically, and activeColor: '#5b8def' matches the same accent blue
  // every other widget's own default active/fill color already uses (Dial
  // Switch's fill, Gauge's fill, ...) instead of falling back to
  // pickAutoActiveColor's auto-lightened-gray.
  function defaultRockerPositions(): RockerSwitchWidget['positions'] {
    return [
      {
        id: nextId(),
        name: 'On',
        labels: [{ id: nextId(), text: 'On', fontFamily: DEFAULT_FONT_ID, align: 'center', verticalAlign: 'center' }],
        activeColor: '#5b8def',
        onSelect: []
      },
      {
        id: nextId(),
        name: 'Off',
        labels: [{ id: nextId(), text: 'Off', fontFamily: DEFAULT_FONT_ID, align: 'center', verticalAlign: 'center' }],
        activeColor: '#5b8def',
        onSelect: []
      }
    ]
  }

  function handleAddRockerSwitch(): void {
    const pos = spawnPosition()
    const widget: RockerSwitchWidget = {
      id: nextId(),
      type: 'switch-rocker',
      x: pos.x,
      y: pos.y,
      w: 60,
      h: 160,
      orientation: 'vertical',
      positions: defaultRockerPositions(),
      track: { color: DEFAULT_WIDGET_COLOR },
      labels: [],
      events: { press: [], release: [], positionChange: [] },
      onInactive: []
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  // Dial-Switch-specific (the only remaining caller of what used to be the
  // shared defaultPositions() — Rocker/Dropdown each got their own above).
  // Four positions with an explicit unselected color and the same accent
  // activeColor every other widget's own default now uses, plus
  // labelDistance so each detent's label sits a bit further out than the
  // fixed default offset.
  function defaultDialSwitchPositions(): DialSwitchWidget['positions'] {
    return ['1', '2', '3', '4'].map((text, i) => ({
      id: nextId(),
      name: `Position ${i + 1}`,
      labels: [{ id: nextId(), text, fontFamily: DEFAULT_FONT_ID, align: 'center', verticalAlign: 'center', labelDistance: 20 }],
      color: '#3a3f4a',
      activeColor: '#5b8def',
      onSelect: []
    }))
  }

  function handleAddDialSwitch(): void {
    const pos = spawnPosition()
    const widget: DialSwitchWidget = {
      id: nextId(),
      type: 'switch-dial',
      x: pos.x,
      y: pos.y,
      w: 100,
      h: 100,
      positions: defaultDialSwitchPositions(),
      labels: [],
      track: { color: DEFAULT_WIDGET_COLOR },
      fill: { color: '#5b8def' },
      events: { press: [], release: [], positionChange: [], increment: [], decrement: [], doublePress: [], triplePress: [] },
      fireWhileDragging: true,
      interactionMode: 'drag',
      startAngle: 270,
      endAngle: 450,
      dialShape: 'square',
      squareWidth: 22,
      squareHeight: 56,
      indicatorShape: 'triangle',
      indicatorStyle: { width: 22 },
      indicatorDistance: 33,
      detentShape: 'tick',
      detentStyle: { height: 9, width: 2 },
      detentRadius: 49
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  function defaultTogglePositions(): ToggleSwitchWidget['positions'] {
    return [
      {
        id: nextId(),
        name: 'Top',
        labels: [{ id: nextId(), text: 'Top', fontFamily: DEFAULT_FONT_ID, align: 'center', verticalAlign: 'center', padding: 8, labelDistance: 20 }],
        onSelect: []
      },
      {
        id: nextId(),
        name: 'Bottom',
        labels: [{ id: nextId(), text: 'Bottom', fontFamily: DEFAULT_FONT_ID, align: 'center', verticalAlign: 'center', labelDistance: 20 }],
        onSelect: []
      }
    ]
  }

  function handleAddToggleSwitch(): void {
    const pos = spawnPosition()
    const widget: ToggleSwitchWidget = {
      id: nextId(),
      type: 'switch-toggle',
      x: pos.x,
      y: pos.y,
      w: 70,
      h: 130,
      orientation: 'vertical',
      positions: defaultTogglePositions(),
      labels: [],
      track: { color: DEFAULT_WIDGET_COLOR },
      fill: { color: '#5b8def' },
      events: { press: [], release: [], positionChange: [], guardToggle: [] },
      fireWhileDragging: true,
      leverLength: 40,
      leverTipRadius: 12,
      leverBaseRadius: 7,
      bezelRadius: 42
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  function handleAddToggleVariant(variant: WidgetVariant<ToggleSwitchWidget>): void {
    const widget = variant.build(spawnPosition())
    addWidget(widget)
    selectWidget(widget.id)
  }

  // Dropdown-specific — same activeColor: '#5b8def' reasoning as
  // defaultRockerPositions() above.
  function defaultDropdownPositions(): DropdownWidget['positions'] {
    return [
      {
        id: nextId(),
        name: 'Position 1',
        labels: [{ id: nextId(), text: 'Position 1', fontFamily: DEFAULT_FONT_ID, align: 'center', verticalAlign: 'center' }],
        activeColor: '#5b8def',
        onSelect: []
      },
      {
        id: nextId(),
        name: 'Position 2',
        labels: [{ id: nextId(), text: 'Position 2', fontFamily: DEFAULT_FONT_ID, align: 'center', verticalAlign: 'center' }],
        activeColor: '#5b8def',
        onSelect: []
      },
      {
        id: nextId(),
        name: 'Position 3',
        labels: [{ id: nextId(), text: 'Position 3', fontFamily: DEFAULT_FONT_ID, align: 'center', verticalAlign: 'center' }],
        activeColor: '#5b8def',
        onSelect: []
      }
    ]
  }

  function handleAddDropdown(): void {
    const pos = spawnPosition()
    const widget: DropdownWidget = {
      id: nextId(),
      type: 'dropdown',
      x: pos.x,
      y: pos.y,
      w: 120,
      h: 36,
      orientation: 'top-to-bottom',
      positions: defaultDropdownPositions(),
      events: { press: [], release: [], positionChange: [] },
      track: { color: DEFAULT_WIDGET_COLOR }
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  function handleAddLabel(): void {
    const pos = spawnPosition()
    const widget: LabelWidget = {
      id: nextId(),
      type: 'label',
      x: pos.x,
      y: pos.y,
      w: 160,
      h: 40,
      label: { id: nextId(), text: 'Label', fontFamily: DEFAULT_FONT_ID, align: 'center', verticalAlign: 'center' }
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  function handleAddLine(): void {
    const pos = spawnPosition()
    const widget: LineWidget = {
      id: nextId(),
      type: 'line',
      x: pos.x,
      y: pos.y,
      w: 160,
      h: 4,
      lineWidth: 1,
      color: '#ffffff'
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  function handleAddScreenCapture(): void {
    const pos = spawnPosition()
    const widget: ScreenCaptureWidget = {
      id: nextId(),
      type: 'screen-capture',
      x: pos.x,
      y: pos.y,
      w: 240,
      h: 160,
      streamMode: 'poll',
      fps: 5,
      quality: 70
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  function handleAddDcsViewport(): void {
    const pos = spawnPosition()
    const widget: DcsViewportWidget = {
      id: nextId(),
      type: 'dcs-viewport',
      x: pos.x,
      y: pos.y,
      w: 240,
      h: 160,
      streamMode: 'poll',
      fps: 5,
      quality: 70
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  return (
    <aside className="palette">
      <h2 className="palette__title">Widgets</h2>
      <PaletteVariantButton<ButtonWidget>
        label="+ Button"
        onAddPlain={handleAddButton}
        variants={BUTTON_VARIANTS}
        onSelectVariant={handleAddButtonVariant}
      />
      <button className="palette__item" onClick={handleAddLabel}>
        + Label
      </button>
      <button className="palette__item" onClick={handleAddLine}>
        + Line
      </button>
      <button className="palette__item" onClick={handleAddMorph}>
        + Morph button
      </button>
      <button className="palette__item" onClick={handleAddBarGauge}>
        + Bar Gauge
      </button>
      <button className="palette__item" onClick={handleAddArcGauge}>
        + Arc Gauge
      </button>
      <button className="palette__item" onClick={handleAddSlider}>
        + Slider
      </button>
      <button className="palette__item" onClick={handleAddKnob}>
        + Knob
      </button>
      <button className="palette__item" onClick={handleAddEncoder}>
        + Encoder
      </button>
      <button className="palette__item" onClick={handleAddRockerSwitch}>
        + Rocker switch
      </button>
      <button className="palette__item" onClick={handleAddDialSwitch}>
        + Dial switch
      </button>
      <PaletteVariantButton
        label="+ Toggle switch"
        onAddPlain={handleAddToggleSwitch}
        variants={TOGGLE_SWITCH_VARIANTS}
        onSelectVariant={handleAddToggleVariant}
      />
      <button className="palette__item" onClick={handleAddDropdown}>
        + Dropdown
      </button>
      {screenCaptureAvailable && (
        <button className="palette__item" onClick={handleAddScreenCapture}>
          + Screen capture
        </button>
      )}
      {dcsViewportsAvailable && (
        <button className="palette__item" onClick={handleAddDcsViewport}>
          + DCS viewport
        </button>
      )}
      <p className="palette__hint">Click a widget on the canvas to edit its label, keybind, and position in the properties panel.</p>
      <p className="palette__hint">
        Morph buttons: select one, then use the + handles on its edges to extend it into other base blocks — connected blocks act as
        one button. Hold Ctrl to remove instead.
      </p>
      <p className="palette__hint">
        Lines are a plain decorative bar — drag the handle to resize length (thickness is set in Properties), and use Rotation to angle
        it away from horizontal.
      </p>
      <p className="palette__hint">
        Gauges display a variable; Adjusters (slider/knob) drag to set one — see its Actions section in Properties for Press/Release/Move.
      </p>
      <p className="palette__hint">
        Encoders spin (drag in a circle) to fire Turn CW/CCW steps — good for DCS-BIOS INC/DEC knobs with no fixed range. Rocker/Dial
        switches have 2+ tappable positions, each with its own action — good for DCS-BIOS set-position controls (gear, mode
        selectors, ...). Which position looks active is local to each device unless you wire an "Active position" expression to a
        shared variable.
      </p>
      <p className="palette__hint">
        Toggle switches are Rocker's physical-lever cousin — always 2 (Top/Bottom) or 3 (Top/Middle/Bottom) positions, names fixed.
        Top/Bottom can be set Momentary (springs back to Middle on release on a 3-position switch, or to the other position on a
        2-position switch — only one of the two can be momentary there). Interaction mode picks Tap (tap a position directly) or Drag
        (press and drag toward a position, like Dial) — Momentary fires live in either mode, not just on release.
      </p>
      <p className="palette__hint">
        Dropdowns show only the active position until pressed and held, then fan the rest out above/below (or left/right) it — drag to
        the one you want and release to select it. Has its own Press/Release (fires on every hold) alongside each position's own action
        (fires only if you release on it).
      </p>
    </aside>
  )
}
