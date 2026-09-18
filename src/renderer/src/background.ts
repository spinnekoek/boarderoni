import { SERVER_PORT } from '@shared/constants'
import type { BackgroundAnchor, BackgroundFit } from '@shared/types'
import { getDeviceId, getDeviceToken } from './id'

const SIZE_AND_REPEAT: Record<BackgroundFit, { backgroundSize: string; backgroundRepeat: string }> = {
  cover: { backgroundSize: 'cover', backgroundRepeat: 'no-repeat' },
  contain: { backgroundSize: 'contain', backgroundRepeat: 'no-repeat' },
  stretch: { backgroundSize: '100% 100%', backgroundRepeat: 'no-repeat' },
  tile: { backgroundSize: 'auto', backgroundRepeat: 'repeat' },
  none: { backgroundSize: 'auto', backgroundRepeat: 'no-repeat' }
}

const POSITION: Record<BackgroundAnchor, string> = {
  'top-left': 'left top',
  'top-center': 'center top',
  'top-right': 'right top',
  'center-left': 'left center',
  center: 'center center',
  'center-right': 'right center',
  'bottom-left': 'left bottom',
  'bottom-center': 'center bottom',
  'bottom-right': 'right bottom'
}

export const ANCHOR_OPTIONS: BackgroundAnchor[] = [
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right'
]

export function backgroundImageStyle(fit: BackgroundFit, anchor: BackgroundAnchor): React.CSSProperties {
  return { ...SIZE_AND_REPEAT[fit], backgroundPosition: POSITION[anchor] }
}

// The image bytes live server-side (see main/index.ts) and are fetched over
// plain HTTP rather than embedded in the synced dashboard JSON — embedding it
// there would mean every dashboard update, including per-frame widget drags,
// re-sends the whole image to every connected client. Scoped to a deck (the
// server keeps one background image per deck) via the `deck` query param.
// device/token: unconditionally appended regardless of edit vs view mode —
// see main/index.ts's hasDeviceContentAccess for why that's fine (the
// editor's own request is loopback-trusted and never needs these; only a
// remote view device's request actually depends on them verifying).
// getDeviceToken() returning null (never-approved editor, or a view device
// that hasn't been approved yet) just means an empty token param, which
// fails verification the same as any other invalid one — never a crash.
export function backgroundImageUrl(deckId: string, version: number): string {
  const host = window.location.hostname || 'localhost'
  const device = encodeURIComponent(getDeviceId())
  const token = encodeURIComponent(getDeviceToken() ?? '')
  return `http://${host}:${SERVER_PORT}/background-image?deck=${encodeURIComponent(deckId)}&v=${version}&device=${device}&token=${token}`
}
