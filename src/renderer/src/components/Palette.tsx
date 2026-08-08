import { useDashboardStore } from '../store'
import { DEFAULT_FONT_ID } from '@shared/fonts'
import { DEFAULT_WIDGET_COLOR } from '@shared/color'
import { nextId } from '../id'
import type { AdjusterWidget, ButtonWidget, GaugeWidget, MorphButtonWidget } from '@shared/types'

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
      action: { kind: 'keypress', keys: [] },
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
      action: { kind: 'keypress', keys: [] },
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
      action: { kind: 'keypress', keys: [] },
      fill: { color: '#5b8def' },
      track: { color: DEFAULT_WIDGET_COLOR },
      labels: []
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
      <p className="palette__hint">Click a widget on the canvas to edit its label, keybind, and position in the properties panel.</p>
      <p className="palette__hint">
        Morph buttons: select one, then use the + handles on its edges to extend it into other base blocks — connected blocks act as
        one button. Hold Ctrl to remove instead.
      </p>
      <p className="palette__hint">
        Gauges display a variable; Adjusters (slider/knob) drag to set one — see its Action field in Properties, same as a button's.
      </p>
    </aside>
  )
}
