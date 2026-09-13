import { useEffect, useRef, useState } from 'react'

const SETTINGS_GESTURE_FINGER_COUNT = 5

// The 5-finger touch gesture (plus its Ctrl/Cmd+I desktop-browser keyboard
// equivalent) that opens DeviceSettingsModal — shared by ViewCanvas (gesture
// during normal deck viewing) and DeckPicker's view-mode branch (gesture
// from the deck list, before any deck is loaded).
//
// `enabled` (default true) gates the keyboard listener too, not just the
// touch handlers — DeckPicker passes `mode === 'view'` so its edit-mode
// branch (the desktop editor's own deck list) doesn't grow a hidden Ctrl+I
// shortcut that flips state nothing ever renders.
export function useSettingsGesture(enabled = true): {
  settingsOpen: boolean
  closeSettings: () => void
  handleTouchStart: (e: React.TouchEvent) => void
  handleTouchEnd: (e: React.TouchEvent) => void
} {
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Guards against re-opening on every touchmove while 5+ fingers stay down,
  // and resets once every finger has lifted so the next 5-finger touch can
  // open it again.
  const gestureFiredRef = useRef(false)

  function handleTouchStart(e: React.TouchEvent): void {
    if (!enabled) return
    if (e.touches.length >= SETTINGS_GESTURE_FINGER_COUNT && !gestureFiredRef.current) {
      gestureFiredRef.current = true
      setSettingsOpen(true)
    }
  }

  function handleTouchEnd(e: React.TouchEvent): void {
    if (e.touches.length === 0) gestureFiredRef.current = false
  }

  // The keyboard equivalent — for opening this same modal from a regular
  // desktop browser (e.g. testing the appUrl link from MobileAppModal in
  // Chrome), where there's no touchscreen to 5-finger tap.
  useEffect(() => {
    if (!enabled) return
    function handleKeyDown(e: KeyboardEvent): void {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
      if (e.key.toLowerCase() !== 'i') return
      e.preventDefault()
      setSettingsOpen(true)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enabled])

  return { settingsOpen, closeSettings: () => setSettingsOpen(false), handleTouchStart, handleTouchEnd }
}
