import { useRef } from 'react'
import { useEscapeToClose } from '../useEscapeToClose'
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

  // CodeEditor now commits on blur, not per keystroke (see its own doc
  // comment) — closing this modal usually blurs it naturally first, but
  // that's not guaranteed for every close path (Escape while focus is
  // elsewhere, a backdrop click that never focused the editor at all this
  // session), so every path here flushes explicitly rather than trusting
  // that.
  function handleClose(): void {
    editorRef.current?.flush()
    onClose()
  }

  useEscapeToClose(handleClose)

  return (
    <div className="expr-modal-overlay" onPointerDown={handleClose}>
      <div className="expr-modal" onPointerDown={(e) => e.stopPropagation()}>
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
