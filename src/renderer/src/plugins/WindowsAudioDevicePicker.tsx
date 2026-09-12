import { useEffect, useRef, useState } from 'react'

// A native <select> can't render anything but plain text inside its own
// options — no way to put a colored "Default" tag on just one row of the
// OPEN dropdown list, only next to the closed control showing whatever's
// currently selected. This is a small custom listbox instead, specifically
// so the default device can be tagged right in the list itself, shared by
// WindowsAudioConfigPanel (the event source's own device picker) and
// SetWindowsAudioActionEditor (the action's device picker) in
// PropertiesPanel.tsx — same widget, two call sites.
export function WindowsAudioDevicePicker({
  devices,
  value,
  onChange
}: {
  devices: { name: string; isDefault: boolean }[] | null
  value: string
  onChange: (deviceName: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: PointerEvent): void {
      if (rootRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  if (devices === null) {
    return <span className="properties__hint-inline">Loading devices…</span>
  }

  // '' always tracks whichever device is currently default, so it reads as
  // one too — same convention WindowsAudioConfigPanel's own deviceName
  // field comment describes.
  const selected = value === '' ? undefined : devices.find((d) => d.name === value)
  const selectedLabel = value === '' ? 'Default output device (follows Windows)' : (selected?.name ?? value)
  const selectedIsDefault = value === '' || (selected?.isDefault ?? false)

  function pick(deviceName: string): void {
    onChange(deviceName)
    setOpen(false)
  }

  return (
    <div className="windows-audio-device-picker" ref={rootRef}>
      <button type="button" className="windows-audio-device-picker__toggle" onClick={() => setOpen((o) => !o)}>
        <span className="windows-audio-device-picker__toggle-label">{selectedLabel}</span>
        {selectedIsDefault && <span className="windows-audio__default-tag">Default</span>}
        <span className="windows-audio-device-picker__chevron">▾</span>
      </button>
      {open && (
        <div className="windows-audio-device-picker__menu">
          <button type="button" className="windows-audio-device-picker__row" onClick={() => pick('')}>
            <span>Default output device (follows Windows)</span>
            <span className="windows-audio__default-tag">Default</span>
          </button>
          {devices.map((d) => (
            <button key={d.name} type="button" className="windows-audio-device-picker__row" onClick={() => pick(d.name)}>
              <span>{d.name}</span>
              {d.isDefault && <span className="windows-audio__default-tag">Default</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
