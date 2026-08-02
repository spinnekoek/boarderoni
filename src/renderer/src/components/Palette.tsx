import { useDashboardStore } from '../store'
import { DEFAULT_FONT_ID } from '@shared/fonts'
import type { ButtonWidget } from '@shared/types'

function nextId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `w_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

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
      label: 'New Button',
      fontFamily: DEFAULT_FONT_ID,
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
