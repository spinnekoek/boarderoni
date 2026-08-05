import { useEffect } from 'react'

// Closes a modal on Escape — shared by every full-screen overlay (Variables,
// Events, the expanded expression editor, device settings, the confirm
// dialog). Bubble phase, unlike ContextMenu's own capture-phase pointerdown
// listener, since nothing inside a modal calls stopPropagation on keydown.
export function useEscapeToClose(onClose: () => void): void {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])
}
