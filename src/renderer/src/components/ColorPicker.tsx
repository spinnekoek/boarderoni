import { COLOR_PALETTE } from '@shared/color'

export function ColorPicker({
  value,
  onChange,
  auto = false
}: {
  value: string
  onChange: (color: string) => void
  // When true, `value` is a computed fallback (e.g. "auto" text color) rather
  // than an explicit user choice, so no swatch should render as selected.
  auto?: boolean
}): React.JSX.Element {
  const isPreset = !auto && COLOR_PALETTE.some((color) => color.toLowerCase() === value.toLowerCase())
  const isCustomActive = !auto && !isPreset

  return (
    <div className="color-picker">
      {COLOR_PALETTE.map((color) => (
        <button
          key={color}
          type="button"
          className={`color-picker__swatch${!auto && value.toLowerCase() === color.toLowerCase() ? ' color-picker__swatch--active' : ''}`}
          style={{ backgroundColor: color }}
          onClick={() => onChange(color)}
          title={color}
        />
      ))}
      <label
        className={`color-picker__custom${isCustomActive ? ' color-picker__custom--active' : ''}`}
        title="Custom color"
        style={{ backgroundColor: isCustomActive ? value : undefined }}
      >
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
        <span>+</span>
      </label>
    </div>
  )
}
