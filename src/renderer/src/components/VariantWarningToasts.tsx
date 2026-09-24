import { useEffect, useRef } from 'react'
import { useVariantWarningStore, type VariantWarning } from '../variantWarningStore'

const AUTO_DISMISS_MS = 30000

function WarningToast({ warning, onDismiss }: { warning: VariantWarning; onDismiss: () => void }): React.JSX.Element {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    timeoutRef.current = setTimeout(onDismiss, AUTO_DISMISS_MS)
    return () => clearTimeout(timeoutRef.current)
  }, [onDismiss])

  // Hovering pauses the countdown (cleared here, restarted at full length
  // on mouseLeave below) rather than tracking exact remaining time — a
  // warning you're actively reading shouldn't vanish out from under you.
  function handleMouseEnter(): void {
    clearTimeout(timeoutRef.current)
  }

  function handleMouseLeave(): void {
    timeoutRef.current = setTimeout(onDismiss, AUTO_DISMISS_MS)
  }

  return (
    <div className="toast toast--warning" role="alert" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      <button type="button" className="toast__dismiss" title="Dismiss" onClick={onDismiss}>
        ×
      </button>
      <div className="toast__title">
        <span className="toast__icon" aria-hidden="true">
          ⚠
        </span>
        Warning: Missing variables
      </div>
      <div className="toast__message">{warning.message}</div>
    </div>
  )
}

// Editor-only counterpart to ToastStack (that one's client-only, see
// its own comment) — mounted in App.tsx's editor branch. Only ever fires
// from Palette.tsx placing a widget variant that references variables not
// yet configured in this dashboard. Top-anchored (toast-stack--top) rather
// than ToastStack's own default bottom placement, so it's seen right away
// next to the palette/canvas instead of easy to miss down in the corner.
export function VariantWarningToasts(): React.JSX.Element {
  const warnings = useVariantWarningStore((s) => s.warnings)
  const dismissWarning = useVariantWarningStore((s) => s.dismissWarning)
  return (
    <div className="toast-stack toast-stack--top">
      {warnings.map((warning) => (
        <WarningToast key={warning.id} warning={warning} onDismiss={() => dismissWarning(warning.id)} />
      ))}
    </div>
  )
}
