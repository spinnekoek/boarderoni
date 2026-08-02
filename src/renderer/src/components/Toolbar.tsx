import { useEditorSettings } from '../settingsStore'

export function Toolbar(): React.JSX.Element {
  const snapToGrid = useEditorSettings((s) => s.snapToGrid)
  const gridSize = useEditorSettings((s) => s.gridSize)
  const setSnapToGrid = useEditorSettings((s) => s.setSnapToGrid)
  const setGridSize = useEditorSettings((s) => s.setGridSize)

  return (
    <div className="toolbar">
      <label className="toolbar__control">
        <input type="checkbox" checked={snapToGrid} onChange={(e) => setSnapToGrid(e.target.checked)} />
        Snap to grid
      </label>
      <label className="toolbar__control">
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
    </div>
  )
}
