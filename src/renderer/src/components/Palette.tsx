import { useDashboardStore } from '../store'
import { DEFAULT_FONT_ID } from '@shared/fonts'
import { DEFAULT_WIDGET_COLOR } from '@shared/color'
import { nextId } from '../id'
import type {
  AdjusterWidget,
  ButtonWidget,
  DialSwitchWidget,
  DropdownWidget,
  EncoderWidget,
  GaugeWidget,
  MorphButtonWidget,
  RockerSwitchWidget
} from '@shared/types'

export function Palette(): React.JSX.Element {
  const addWidget = useDashboardStore((s) => s.addWidget)
  const selectWidget = useDashboardStore((s) => s.selectWidget)

  function handleAddButton(): void {
    const widget: ButtonWidget = {
      id: nextId(),
      type: 'button',
      x: 40,
      y: 40,
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
    const widget: MorphButtonWidget = {
      id: nextId(),
      type: 'morph',
      x: 40,
      y: 40,
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
    const widget: GaugeWidget = {
      id: nextId(),
      type: 'gauge',
      x: 40,
      y: 40,
      w: 160,
      h: 40,
      valueExpr: 'return variables.my_variable ?? 0;',
      min: 0,
      max: 100,
      style: 'bar',
      orientation: 'horizontal',
      fill: { color: '#5b8def' },
      track: { color: DEFAULT_WIDGET_COLOR },
      labels: []
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  function handleAddAdjuster(): void {
    const widget: AdjusterWidget = {
      id: nextId(),
      type: 'adjuster',
      x: 40,
      y: 40,
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
    const widget: EncoderWidget = {
      id: nextId(),
      type: 'encoder',
      x: 40,
      y: 40,
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
    const widget: RockerSwitchWidget = {
      id: nextId(),
      type: 'switch-rocker',
      x: 40,
      y: 40,
      w: 60,
      h: 160,
      orientation: 'vertical',
      positions: defaultPositions(),
      track: { color: DEFAULT_WIDGET_COLOR }
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  function handleAddDialSwitch(): void {
    const widget: DialSwitchWidget = {
      id: nextId(),
      type: 'switch-dial',
      x: 40,
      y: 40,
      w: 120,
      h: 120,
      positions: defaultPositions(),
      track: { color: DEFAULT_WIDGET_COLOR },
      fill: { color: '#5b8def' }
    }
    addWidget(widget)
    selectWidget(widget.id)
  }

  function handleAddDropdown(): void {
    const widget: DropdownWidget = {
      id: nextId(),
      type: 'dropdown',
      x: 40,
      y: 40,
      w: 120,
      h: 36,
      orientation: 'top-to-bottom',
      positions: defaultPositions(),
      events: { press: [], release: [] },
      track: { color: DEFAULT_WIDGET_COLOR }
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
      <button className="palette__item" onClick={handleAddDropdown}>
        + Dropdown
      </button>
      <p className="palette__hint">Click a widget on the canvas to edit its label, keybind, and position in the properties panel.</p>
      <p className="palette__hint">
        Morph buttons: select one, then use the + handles on its edges to extend it into other base blocks — connected blocks act as
        one button. Hold Ctrl to remove instead.
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
        Dropdowns show only the active position until pressed and held, then fan the rest out above/below (or left/right) it — drag to
        the one you want and release to select it. Has its own Press/Release (fires on every hold) alongside each position's own action
        (fires only if you release on it).
      </p>
    </aside>
  )
}
