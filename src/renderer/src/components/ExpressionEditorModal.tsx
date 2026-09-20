import { useRef, useState } from 'react'
import { useEscapeToClose } from '../useEscapeToClose'
import { getExprModalSize, setExprModalSize } from '../id'
import { CodeEditor, type CodeEditorHandle } from './CodeEditor'

export function ExpressionEditorModal({
  value,
  onChange,
  placeholder,
  onClose
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  onClose: () => void
}): React.JSX.Element {
  const editorRef = useRef<CodeEditorHandle>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  // Read once on mount, not on every render — the value is only needed as
  // the element's starting size, and re-reading it later would fight the
  // size the user is actively dragging.
  const [initialSize] = useState(getExprModalSize)

  // CodeEditor now commits on blur, not per keystroke (see its own doc
  // comment) — closing this modal usually blurs it naturally first, but
  // that's not guaranteed for every close path (Escape while focus is
  // elsewhere, a backdrop click that never focused the editor at all this
  // session), so every path here flushes explicitly rather than trusting
  // that.
  //
  // The size is captured here rather than from a ResizeObserver so it's
  // written once per close instead of on every frame of a resize drag —
  // every way out of this modal (×, Done, Escape, backdrop) routes through
  // here, so there's no path that loses it.
  function handleClose(): void {
    editorRef.current?.flush()
    const el = modalRef.current
    if (el) setExprModalSize({ width: el.offsetWidth, height: el.offsetHeight })
    onClose()
  }

  useEscapeToClose(handleClose)

  return (
    <div className="expr-modal-overlay" onPointerDown={handleClose}>
      {/* No style at all until the modal has actually been resized once, so
          the stylesheet's own default size stays the single source of truth
          for it rather than being duplicated here. */}
      <div
        className="expr-modal"
        ref={modalRef}
        style={initialSize ? { width: initialSize.width, height: initialSize.height } : undefined}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="expr-modal__header">
          <h2 className="expr-modal__title">Edit expression</h2>
          <button type="button" className="modal-close" title="Close" onClick={handleClose}>
            ×
          </button>
        </div>
        <div className="expr-modal__editor">
          <CodeEditor ref={editorRef} value={value} onChange={onChange} placeholder={placeholder} />
        </div>
        <div className="expr-modal__actions">
          <button className="expr-modal__done" onClick={handleClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
