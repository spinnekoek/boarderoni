// A label's resolved text (see resolveLabelText in expr.ts) can embed two
// kinds of inline tokens, recognized the same way whether the text came from
// the plain `text` field or a `textExpr` expression's returned string:
//   - `{{icon:fa-image}}` — rendered as a FontAwesome icon (see
//     renderer/src/components/widgets/faIcons.ts for the name lookup)
//   - U+2424 (SYMBOL FOR NEWLINE, "␤") — rendered as a line break, the same
//     character Shift+Enter inserts in the plain-text label input (see
//     PropertiesPanel.tsx) since a single-line <input> can't hold a real \n
export type LabelContentPart = { kind: 'text'; value: string } | { kind: 'icon'; name: string } | { kind: 'break' }

const LABEL_TOKEN_RE = /\{\{icon:([a-zA-Z0-9-]+)\}\}|␤/g

export function parseLabelContent(text: string): LabelContentPart[] {
  const parts: LabelContentPart[] = []
  let lastIndex = 0
  for (const match of text.matchAll(LABEL_TOKEN_RE)) {
    const index = match.index
    if (index > lastIndex) parts.push({ kind: 'text', value: text.slice(lastIndex, index) })
    parts.push(match[1] ? { kind: 'icon', name: match[1] } : { kind: 'break' })
    lastIndex = index + match[0].length
  }
  if (lastIndex < text.length) parts.push({ kind: 'text', value: text.slice(lastIndex) })
  return parts
}
