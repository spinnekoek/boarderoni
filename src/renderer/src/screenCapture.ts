import { SERVER_PORT } from '@shared/constants'

// The frame/stream bytes live server-side (see main/screenCapture.ts) and
// are fetched over plain HTTP, same "small pointer in dashboard JSON, real
// bytes over HTTP" convention as background.ts's own backgroundImageUrl —
// nothing about a captured frame belongs in the WebSocket-synced Dashboard.
function host(): string {
  return window.location.hostname || 'localhost'
}

// cacheBust forces a fresh fetch each poll tick — the server has no cache
// headers of its own to fight (Cache-Control: no-store), but the query
// param also doubles as what actually changes `<img src>` so React/the
// browser knows to re-request instead of no-op'ing on an unchanged src.
export function screenCaptureFrameUrl(deckId: string, widgetId: string, cacheBust: number): string {
  return `http://${host()}:${SERVER_PORT}/screen-capture/frame?deck=${encodeURIComponent(deckId)}&widget=${encodeURIComponent(widgetId)}&t=${cacheBust}`
}

// One persistent multipart/x-mixed-replace connection — set as `<img src>`
// once, never refreshed; the browser/WebView updates it in place as the
// server pushes new frames.
export function screenCaptureStreamUrl(deckId: string, widgetId: string): string {
  return `http://${host()}:${SERVER_PORT}/screen-capture/stream?deck=${encodeURIComponent(deckId)}&widget=${encodeURIComponent(widgetId)}`
}
