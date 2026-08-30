import { useDashboardStore } from '../store'
import { useEditorSettings } from '../settingsStore'
import { DEFAULT_FONT_ID } from '@shared/fonts'
import { DEFAULT_WIDGET_COLOR } from '@shared/color'
import { isWidgetTypeGatedByDisabledPlugin } from '@shared/plugins'
import { nextId } from '../id'
import type {
  AdjusterWidget,
  ButtonWidget,
  DcsViewportWidget,
  DialSwitchWidget,
  DropdownWidget,
  EncoderWidget,
  GaugeWidget,
  LabelWidget,
  LineWidget,
  MorphButtonWidget,
  RockerSwitchWidget,
  ScreenCaptureWidget,
  ToggleSwitchWidget
} from '@shared/types'

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
      events: { press: [], release: [] },
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

  function handleAddMorph(): void {
    const pos = spawnPosition()
    const widget: MorphButtonWidget = {
      id: nextId(),
      type: 'morph',
      x: pos.x,
      y: pos.y,
      cellW: 160,
      cellH: 80,
      blocks: [{ id: nextId(), col: 0, row: 0, perState: {} }],
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

  function handleAddGauge(): void {
    const pos = spawnPosition()
    const widget: GaugeWidget = {
      id: nextId(),
      type: 'gauge',
      x: pos.x,
      y: pos.y,
      w: 160,
      h: 40,
      valueExpr: 'return variables.my_variable ?? 0;',
      min: 0,
      max: 100,
      style: 'bar',
      orientation: 'horizontal',
      fill: { color: '#5b8def' },
      // Left unset, not DEFAULT_WIDGET_COLOR — GaugeWidgetContent's own
      // trackColor fallback already resolves to that same value for 'bar'
      // (no visual change here), but leaves the arc-specific gray default
      // free to apply if this gauge is later switched to 'arc' in the
      // properties panel, rather than an explicit value permanently
      // shadowing it.
      track: {},
      labels: []
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  function handleAddAdjuster(): void {
    const pos = spawnPosition()
    const widget: AdjusterWidget = {
      id: nextId(),
      type: 'adjuster',
      x: pos.x,
      y: pos.y,
      w: 60,
      h: 160,
      style: 'slider',
      orientation: 'vertical',
      min: 0,
      max: 100,
      events: { press: [], release: [], move: [] },
      fill: { color: '#5b8def' },
      track: { color: DEFAULT_WIDGET_COLOR },
      labels: []
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
      events: { increment: [], decrement: [], press: [], release: [] },
      fill: { color: '#5b8def' },
      track: { color: DEFAULT_WIDGET_COLOR },
      labels: []
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  function defaultPositions(): RockerSwitchWidget['positions'] {
    return [
      {
        id: nextId(),
        name: 'Position 1',
        labels: [{ id: nextId(), text: '1', fontFamily: DEFAULT_FONT_ID, align: 'center', verticalAlign: 'center' }],
        onSelect: []
      },
      {
        id: nextId(),
        name: 'Position 2',
        labels: [{ id: nextId(), text: '2', fontFamily: DEFAULT_FONT_ID, align: 'center', verticalAlign: 'center' }],
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
      positions: defaultPositions(),
      track: { color: DEFAULT_WIDGET_COLOR },
      labels: [],
      events: { press: [], release: [], positionChange: [] }
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  function handleAddDialSwitch(): void {
    const pos = spawnPosition()
    const widget: DialSwitchWidget = {
      id: nextId(),
      type: 'switch-dial',
      x: pos.x,
      y: pos.y,
      w: 120,
      h: 120,
      positions: defaultPositions(),
      labels: [],
      track: { color: DEFAULT_WIDGET_COLOR },
      fill: { color: '#5b8def' },
      events: { press: [], release: [], positionChange: [], increment: [], decrement: [] }
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  function defaultTogglePositions(): ToggleSwitchWidget['positions'] {
    return [
      { id: nextId(), name: 'Top', labels: [{ id: nextId(), text: 'Top', fontFamily: DEFAULT_FONT_ID, align: 'center', verticalAlign: 'center' }], onSelect: [] },
      {
        id: nextId(),
        name: 'Bottom',
        labels: [{ id: nextId(), text: 'Bottom', fontFamily: DEFAULT_FONT_ID, align: 'center', verticalAlign: 'center' }],
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
      events: { press: [], release: [], positionChange: [] },
      fireWhileDragging: true
    }
    addWidget(widget)
    selectWidget(widget.id)
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
      positions: defaultPositions(),
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
      <button className="palette__item" onClick={handleAddButton}>
        + Button
      </button>
      <button className="palette__item" onClick={handleAddLabel}>
        + Label
      </button>
      <button className="palette__item" onClick={handleAddLine}>
        + Line
      </button>
      <button className="palette__item" onClick={handleAddMorph}>
        + Morph button
      </button>
      <button className="palette__item" onClick={handleAddGauge}>
        + Gauge
      </button>
      <button className="palette__item" onClick={handleAddAdjuster}>
        + Adjuster
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
      <button className="palette__item" onClick={handleAddToggleSwitch}>
        + Toggle switch
      </button>
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
