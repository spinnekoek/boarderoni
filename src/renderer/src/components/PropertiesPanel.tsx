import { useEffect, useState } from 'react'
import { useDashboardStore } from '../store'
import { FONT_OPTIONS, resolveFont } from '@shared/fonts'
import type { Widget } from '@shared/types'

export function PropertiesPanel(): React.JSX.Element {
  const widgets = useDashboardStore((s) => s.dashboard.widgets)
  const selectedWidgetId = useDashboardStore((s) => s.selectedWidgetId)
  const updateWidgets = useDashboardStore((s) => s.updateWidgets)
  const removeWidget = useDashboardStore((s) => s.removeWidget)
  const selectWidget = useDashboardStore((s) => s.selectWidget)

  const widget = widgets.find((w) => w.id === selectedWidgetId) ?? null
  const [keysDraft, setKeysDraft] = useState('')

  useEffect(() => {
    setKeysDraft(widget?.action.keys.join(',') ?? '')
  }, [widget?.id])

  if (!widget) {
    return (
      <aside className="properties">
        <h2 className="properties__title">Properties</h2>
        <p className="properties__hint">Select a widget on the canvas to view and edit its properties.</p>
      </aside>
    )
  }

  function patch(fields: Partial<Widget>): void {
    updateWidgets(widgets.map((w) => (w.id === widget!.id ? { ...w, ...fields } : w)))
  }

  function commitKeys(): void {
    const keys = keysDraft
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)
    patch({ action: { ...widget!.action, keys } })
  }

  return (
    <aside className="properties">
      <h2 className="properties__title">Properties</h2>

      <label className="properties__field">
        <span>Label</span>
        <input value={widget.label} onChange={(e) => patch({ label: e.target.value })} />
      </label>

      <label className="properties__field">
        <span>Font</span>
        <select
          value={resolveFont(widget.fontFamily).id}
          onChange={(e) => patch({ fontFamily: e.target.value })}
          style={{ fontFamily: resolveFont(widget.fontFamily).cssFamily }}
        >
          {FONT_OPTIONS.map((f) => (
            <option key={f.id} value={f.id} style={{ fontFamily: f.cssFamily }}>
              {f.label}
              {f.monospace ? ' (mono)' : ''}
            </option>
          ))}
        </select>
      </label>

      <label className="properties__field">
        <span>Keys</span>
        <input
          value={keysDraft}
          onChange={(e) => setKeysDraft(e.target.value)}
          onBlur={commitKeys}
          placeholder="LeftControl,LeftAlt,T"
        />
      </label>
      <p className="properties__hint">
        Exact <code>@nut-tree-fork/nut-js</code> <code>Key</code> enum names, comma-separated.
      </p>

      <div className="properties__grid2">
        <label className="properties__field">
          <span>X</span>
          <input type="number" value={widget.x} onChange={(e) => patch({ x: Number(e.target.value) })} />
        </label>
        <label className="properties__field">
          <span>Y</span>
          <input type="number" value={widget.y} onChange={(e) => patch({ y: Number(e.target.value) })} />
        </label>
        <label className="properties__field">
          <span>W</span>
          <input type="number" min={1} value={widget.w} onChange={(e) => patch({ w: Number(e.target.value) })} />
        </label>
        <label className="properties__field">
          <span>H</span>
          <input type="number" min={1} value={widget.h} onChange={(e) => patch({ h: Number(e.target.value) })} />
        </label>
      </div>

      <button
        className="properties__delete"
        onClick={() => {
          removeWidget(widget.id)
          selectWidget(null)
        }}
      >
        Delete widget
      </button>
    </aside>
  )
}
