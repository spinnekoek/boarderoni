// "Application" mode's own picker (see WindowsAudioTargetPicker.tsx) — a
// plain <select>, unlike WindowsAudioDevicePicker's custom listbox, since
// there's no per-row "Default" tag (or any other per-row state) worth
// fighting a native <option>'s plain-text-only limitation for here.
export function WindowsAudioSessionPicker({
  sessions,
  value,
  onChange
}: {
  sessions: { name: string; appName: string }[] | null
  value: string
  onChange: (appName: string) => void
}): React.JSX.Element {
  if (sessions === null) {
    return <span className="properties__hint-inline">Loading applications…</span>
  }

  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Pick an application…</option>
      {sessions.map((s) => (
        <option key={s.appName} value={s.appName}>
          {s.name || s.appName}
        </option>
      ))}
      {value !== '' && !sessions.some((s) => s.appName === value) && <option value={value}>{value} (not currently active)</option>}
    </select>
  )
}
