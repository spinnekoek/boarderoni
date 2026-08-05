export function OpacityField({
  label,
  value,
  onChange
}: {
  label: string
  value: number
  onChange: (value: number) => void
}): React.JSX.Element {
  return (
    <label className="properties__field">
      <span>
        {label} <span className="properties__hint-inline">{Math.round(value * 100)}%</span>
      </span>
      <input type="range" min={0} max={1} step={0.01} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )
}
