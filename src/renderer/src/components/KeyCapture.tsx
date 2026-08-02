import { useRef, useState } from 'react'
import { codeToKeyName } from '../keyCapture'

export function KeyCapture({ keys, onChange }: { keys: string[]; onChange: (keys: string[]) => void }): React.JSX.Element {
  const [active, setActive] = useState(false)
  const heldCodes = useRef<Set<string>>(new Set())

  function handleKeyDown(e: React.KeyboardEvent): void {
    e.preventDefault()
    e.stopPropagation()
    if (e.repeat || heldCodes.current.has(e.code)) return

    const startingNewChord = heldCodes.current.size === 0
    heldCodes.current.add(e.code)

    const mapped = codeToKeyName(e.code)
    if (!mapped) return

    onChange(startingNewChord ? [mapped] : [...keys, mapped])
  }

  function handleKeyUp(e: React.KeyboardEvent): void {
    e.preventDefault()
    e.stopPropagation()
    heldCodes.current.delete(e.code)
  }

  return (
    <div
      className={`key-capture${active ? ' key-capture--active' : ''}`}
      tabIndex={0}
      onFocus={() => setActive(true)}
      onBlur={() => {
        setActive(false)
        heldCodes.current.clear()
      }}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
    >
      {keys.length > 0 ? keys.join(' + ') : active ? 'Press keys…' : 'Click, then press keys'}
    </div>
  )
}
