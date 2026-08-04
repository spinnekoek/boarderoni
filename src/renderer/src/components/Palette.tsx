import { useDashboardStore } from '../store'
import { DEFAULT_FONT_ID } from '@shared/fonts'
import { nextId } from '../id'
import type { ButtonWidget, MorphButtonWidget } from '@shared/types'

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

  return (
    <aside className="palette">
      <h2 className="palette__title">Widgets</h2>
      <button className="palette__item" onClick={handleAddButton}>
        + Button
      </button>
      <button className="palette__item" onClick={handleAddMorph}>
        + Morph button
      </button>
      <p className="palette__hint">Click a widget on the canvas to edit its label, keybind, and position in the properties panel.</p>
      <p className="palette__hint">
        Morph buttons: select one, then use the + handles on its edges to extend it into other base blocks — connected blocks act as
        one button. Hold Ctrl to remove instead.
      </p>
    </aside>
  )
}
