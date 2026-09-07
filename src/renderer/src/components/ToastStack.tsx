import { useEffect } from 'react'
import { useDashboardStore, type ActionErrorToast } from '../store'
import { EVENT_LABELS } from '@shared/widgetEvents'

const TOAST_AUTO_DISMISS_MS = 6000

// Renders a (possibly nested) failure location as a `→`-joined chain, e.g.
// `Press → step 3 → if true → step 2 → if false → step 1` — each branch
// entered on the way to the failing step gets its own "if true"/"if false"
// segment ahead of the step index one level in, so the chain reads as the
// actual path taken through the condition tree rather than a bare number.
function toastDetail(toast: ActionErrorToast): string | undefined {
  if (!toast.event || !toast.path) return undefined
  const segments = toast.path.map((segment, i) => {
    const enteredBranch = i > 0 ? toast.path![i - 1].branch : undefined
    const branchLabel = enteredBranch ? `${enteredBranch === 'whenTrue' ? 'if true' : 'if false'} → ` : ''
    const isLast = i === toast.path!.length - 1
    return branchLabel + (isLast && toast.stepKind === 'delay' ? 'delay step' : `step ${segment.index + 1}`)
  })
  return `${EVENT_LABELS[toast.event]} → ${segments.join(' → ')}`
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
