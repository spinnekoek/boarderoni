import { useEffect, useState } from 'react'
import { usePromptStore } from '../promptStore'
import { useEscapeToClose } from '../useEscapeToClose'

export function PromptModal(): React.JSX.Element | null {
  const request = usePromptStore((s) => s.request)
  const resolve = usePromptStore((s) => s.resolve)
  const [value, setValue] = useState('')
  // Always mounted (see promptStore.ts) — same unconditional-hook-before-
  // early-return reasoning as ConfirmModal's own useEscapeToClose. Resets
  // the input each time a fresh request comes in (this component never
  // unmounts between prompts, so local state would otherwise carry over
  // from whatever the previous prompt's input held).
  useEscapeToClose(() => resolve(null))
  useEffect(() => {
    setValue(request?.defaultValue ?? '')
  }, [request])

  if (!request) return null

  function commit(): void {
    const trimmed = value.trim()
    resolve(trimmed || null)
  }

  return (
    <div className="confirm-modal-overlay" onPointerDown={() => resolve(null)}>
      <div className="confirm-modal" onPointerDown={(e) => e.stopPropagation()}>
        <p className="confirm-modal__message">{request.message}</p>
        <input
          className="prompt-modal__input"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
          }}
        />
        <div className="confirm-modal__actions">
          <button className="confirm-modal__cancel" onClick={() => resolve(null)}>
            {request.cancelLabel}
          </button>
          <button className="prompt-modal__confirm" onClick={commit}>
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
