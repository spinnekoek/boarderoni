import { SERVER_PORT } from '@shared/constants'
import { customFontFieldValue, fontFormatHint, type CustomFont } from '@shared/fonts'

// Same absolute-URL reasoning as background.ts's backgroundImageUrl — the
// renderer's own origin is the Vite dev server in development, not the app's
// actual HTTP/WS server (SERVER_PORT), so a relative url() would 404 there.
function customFontUrl(id: string): string {
  const host = window.location.hostname || 'localhost'
  return `http://${host}:${SERVER_PORT}/fonts/${id}`
}

const STYLE_ELEMENT_ID = 'custom-font-faces'

function styleElement(): HTMLStyleElement {
  const existing = document.getElementById(STYLE_ELEMENT_ID)
  if (existing instanceof HTMLStyleElement) return existing
  const created = document.createElement('style')
  created.id = STYLE_ELEMENT_ID
  document.head.appendChild(created)
  return created
}

// Rebuilds the whole @font-face block from the current list every time
// (rather than diffing in new entries) — the list is always small (this is
// a hand-curated library, not hundreds of fonts), and a full rebuild means a
// deleted font's stale @font-face can never linger. Called once per
// fonts:list message (store.ts), which covers both the initial
// sendInitialState push and any later upload/delete broadcast — every
// connected client (editor and Android view alike) ends up with the same
// rules, no matter which one triggered the change.
export function syncCustomFontFaces(fonts: CustomFont[]): void {
  const css = fonts
    .map((font) => {
      const format = fontFormatHint(font.filename)
      const src = `url("${customFontUrl(font.id)}")${format ? ` format("${format}")` : ''}`
      return `@font-face { font-family: ${JSON.stringify(customFontFieldValue(font.id))}; src: ${src}; }`
    })
    .join('\n')
  styleElement().textContent = css
}
