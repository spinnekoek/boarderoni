import { useEscapeToClose } from '../useEscapeToClose'
import { CodeEditor } from './CodeEditor'

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
  useEscapeToClose(onClose)

  return (
    <div className="expr-modal-overlay" onPointerDown={onClose}>
      <div className="expr-modal" onPointerDown={(e) => e.stopPropagation()}>
        <div className="expr-modal__header">
          <h2 className="expr-modal__title">Edit expression</h2>
          <button type="button" className="modal-close" title="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="expr-modal__editor">
          <CodeEditor value={value} onChange={onChange} placeholder={placeholder} />
        </div>
        <div className="expr-modal__actions">
          <button className="expr-modal__done" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
