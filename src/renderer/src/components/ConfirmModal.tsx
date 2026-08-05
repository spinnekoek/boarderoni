import { useConfirmStore } from '../confirmStore'
import { useEscapeToClose } from '../useEscapeToClose'

export function ConfirmModal(): React.JSX.Element | null {
  const request = useConfirmStore((s) => s.request)
  const resolve = useConfirmStore((s) => s.resolve)
  // Always mounted (see confirmStore.ts) — this hook must run unconditionally
  // regardless of the early return below, so it's registered before that.
  // resolve() on the store is already a no-op when no request is pending
  // (see confirmStore.ts), so Escape firing while no dialog is open is safe.
  useEscapeToClose(() => resolve(false))

  if (!request) return null

  return (
    <div className="confirm-modal-overlay" onPointerDown={() => resolve(false)}>
      <div className="confirm-modal" onPointerDown={(e) => e.stopPropagation()}>
        <p className="confirm-modal__message">{request.message}</p>
        <div className="confirm-modal__actions">
          <button className="confirm-modal__cancel" onClick={() => resolve(false)}>
            {request.cancelLabel}
          </button>
          <button className="confirm-modal__confirm" autoFocus onClick={() => resolve(true)}>
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
