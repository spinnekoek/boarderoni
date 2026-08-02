import { useDashboardStore } from '../store'
import { DEFAULT_FONT_ID } from '@shared/fonts'
import { nextId } from '../id'
import type { ButtonWidget } from '@shared/types'

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
      labels: [{ id: nextId(), text: 'New Button', fontFamily: DEFAULT_FONT_ID, align: 'center', verticalAlign: 'center' }],
      action: { kind: 'keypress', keys: [] }
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
      <p className="palette__hint">Click a widget on the canvas to edit its label, keybind, and position in the properties panel.</p>
    </aside>
  )
}
