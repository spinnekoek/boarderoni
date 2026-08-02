// Maps a browser KeyboardEvent.code (physical key, distinguishes Left/Right)
// to the matching @nut-tree-fork/nut-js Key enum name. Returns null for keys
// with no nut-js equivalent, which the capture UI ignores.
const CODE_TO_KEY: Record<string, string> = {
  ControlLeft: 'LeftControl',
  ControlRight: 'RightControl',
  AltLeft: 'LeftAlt',
  AltRight: 'RightAlt',
  ShiftLeft: 'LeftShift',
  ShiftRight: 'RightShift',
  MetaLeft: 'LeftSuper',
  MetaRight: 'RightSuper',
  Escape: 'Escape',
  Tab: 'Tab',
  CapsLock: 'CapsLock',
  Space: 'Space',
  Enter: 'Return',
  NumpadEnter: 'Enter',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: 'Minus',
  Equal: 'Equal',
  BracketLeft: 'LeftBracket',
  BracketRight: 'RightBracket',
  Backslash: 'Backslash',
  Semicolon: 'Semicolon',
  Quote: 'Quote',
  Comma: 'Comma',
  Period: 'Period',
  Slash: 'Slash',
  Backquote: 'Grave',
  ContextMenu: 'Menu',
  PrintScreen: 'Print',
  ScrollLock: 'ScrollLock',
  Pause: 'Pause',
  NumLock: 'NumLock',
  NumpadAdd: 'Add',
  NumpadSubtract: 'Subtract',
  NumpadMultiply: 'Multiply',
  NumpadDivide: 'Divide',
  NumpadDecimal: 'Decimal',
  NumpadEqual: 'NumPadEqual',
  AudioVolumeMute: 'AudioMute',
  AudioVolumeDown: 'AudioVolDown',
  AudioVolumeUp: 'AudioVolUp',
  MediaPlayPause: 'AudioPlay',
  MediaStop: 'AudioStop',
  MediaTrackPrevious: 'AudioPrev',
  MediaTrackNext: 'AudioNext'
}

for (let i = 0; i <= 9; i++) CODE_TO_KEY[`Digit${i}`] = `Num${i}`
for (let i = 0; i <= 9; i++) CODE_TO_KEY[`Numpad${i}`] = `NumPad${i}`
for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') CODE_TO_KEY[`Key${letter}`] = letter
for (let i = 1; i <= 24; i++) CODE_TO_KEY[`F${i}`] = `F${i}`

export function codeToKeyName(code: string): string | null {
  return CODE_TO_KEY[code] ?? null
}
