import { useEditorSettings } from '../settingsStore'
import { useDashboardStore } from '../store'

export function Toolbar(): React.JSX.Element {
  const snapToGrid = useEditorSettings((s) => s.snapToGrid)
  const gridSize = useEditorSettings((s) => s.gridSize)
  const setSnapToGrid = useEditorSettings((s) => s.setSnapToGrid)
  const setGridSize = useEditorSettings((s) => s.setGridSize)

  const spacing = useDashboardStore((s) => s.dashboard.spacing ?? 0)
  const updateDashboardMeta = useDashboardStore((s) => s.updateDashboardMeta)

  return (
    <div className="toolbar">
      <label className="toolbar__control">
        <input type="checkbox" checked={snapToGrid} onChange={(e) => setSnapToGrid(e.target.checked)} />
        Snap to grid
      </label>
      <label className={`toolbar__control${!snapToGrid ? ' toolbar__control--disabled' : ''}`}>
        <span>Grid size</span>
        <input
          type="number"
          min={1}
          value={gridSize}
          disabled={!snapToGrid}
          onChange={(e) => setGridSize(Number(e.target.value))}
        />
        <span className="toolbar__unit">px</span>
      </label>
      <label className="toolbar__control">
        <span>Grid spacing</span>
        <input
          type="number"
          min={-1}
          value={spacing}
          onChange={(e) => updateDashboardMeta({ spacing: Math.max(-1, Math.round(Number(e.target.value))) })}
        />
        <span className="toolbar__unit">px</span>
      </label>
    </div>
  )
}
