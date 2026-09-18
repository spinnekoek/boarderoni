import { SERVER_PORT } from '@shared/constants'
import { customFontFieldValue, fontFormatHint, type CustomFont } from '@shared/fonts'
import { getDeviceId, getDeviceToken } from './id'

// Same absolute-URL reasoning as background.ts's backgroundImageUrl — the
// renderer's own origin is the Vite dev server in development, not the app's
// actual HTTP/WS server (SERVER_PORT), so a relative url() would 404 there.
// device/token — see backgroundImageUrl's own comment for why these are
// appended unconditionally regardless of edit vs view mode.
function customFontUrl(id: string): string {
  const host = window.location.hostname || 'localhost'
  const device = encodeURIComponent(getDeviceId())
  const token = encodeURIComponent(getDeviceToken() ?? '')
  return `http://${host}:${SERVER_PORT}/fonts/${id}?device=${device}&token=${token}`
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
      // font-display: block (not the default `auto`, which behaves like
      // `swap` once its own brief block period elapses) — a multi-line label
      // whose line-height is tuned for THIS font specifically (see
      // CustomFont.lineHeight's own comment) can overlap when painted in
      // whatever fallback font the browser substitutes while this is still
      // downloading, since the fallback's own glyph metrics don't
      // necessarily fit that tuning. `block` shows nothing for a brief
      // moment instead of the mismatched fallback, then always swaps in
      // this font once it arrives (served from localhost, so that's
      // normally on the order of milliseconds) rather than giving up and
      // keeping the fallback the way `swap`'s failure mode can.
      return `@font-face { font-family: ${JSON.stringify(customFontFieldValue(font.id))}; src: ${src}; font-display: block; }`
    })
    .join('\n')
  styleElement().textContent = css
}
