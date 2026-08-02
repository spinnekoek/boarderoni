import { resolveFont } from '@shared/fonts'
import type { ButtonWidget } from '@shared/types'

export function ButtonWidgetContent({
  widget,
  interactive,
  error,
  onTrigger
}: {
  widget: ButtonWidget
  interactive: boolean
  error?: string
  onTrigger?: () => void
}): React.JSX.Element {
  const fontFamily = resolveFont(widget.fontFamily).cssFamily

  if (interactive) {
    return (
      <button className="deck-button" style={{ fontFamily }} onClick={onTrigger} title={widget.action.keys.join(' + ')}>
        {widget.label}
        {error && <span className="deck-button__error">{error}</span>}
      </button>
    )
  }

  return (
    <div className="deck-button deck-button--static" style={{ fontFamily }}>
      <span className="deck-button__label">{widget.label}</span>
    </div>
  )
}
