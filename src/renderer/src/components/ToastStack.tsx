import { useEffect } from 'react'
import { useDashboardStore, type ActionErrorToast } from '../store'
import { EVENT_LABELS } from '@shared/widgetEvents'

const TOAST_AUTO_DISMISS_MS = 6000

function toastDetail(toast: ActionErrorToast): string | undefined {
  if (!toast.event) return undefined
  const step = toast.stepKind === 'delay' ? 'delay step' : `step ${(toast.stepIndex ?? 0) + 1}`
  return `${EVENT_LABELS[toast.event]} → ${step}`
}

function Toast({ toast, onDismiss }: { toast: ActionErrorToast; onDismiss: () => void }): React.JSX.Element {
  useEffect(() => {
    const timeout = setTimeout(onDismiss, TOAST_AUTO_DISMISS_MS)
    return () => clearTimeout(timeout)
  }, [onDismiss])

  const detail = toastDetail(toast)

  return (
    <div className="toast toast--error" role="alert" onClick={onDismiss}>
      <div className="toast__title">{toast.widgetLabel ?? `Widget ${toast.widgetId}`} action failed</div>
      {detail && <div className="toast__detail">{detail}</div>}
      <div className="toast__message">{toast.message}</div>
    </div>
  )
}

// Always mounted in ViewCanvas — renders an empty (harmless) wrapper when
// there's nothing to show, same "let the parent stay simple" approach the
// rest of this codebase uses rather than conditionally mounting/unmounting.
// Deliberately not rendered anywhere in the editor — action failures are a
// deployed-view-client concern (see store.ts's action:error handler, which
// still also keeps the existing small per-widget `errors` indicator).
export function ToastStack(): React.JSX.Element {
  const toasts = useDashboardStore((s) => s.toasts)
  const dismissToast = useDashboardStore((s) => s.dismissToast)
  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={() => dismissToast(toast.id)} />
      ))}
    </div>
  )
}
