export function nextId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

const DEVICE_ID_KEY = 'boarderoni-device-id'

// A stable identity for this browser/WebView, persisted in localStorage so a
// view client reports the same id across reconnects and app relaunches
// instead of minting a new one (and thus a new device entry) every time.
export function getDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_KEY)
  if (existing) return existing
  const id = nextId()
  localStorage.setItem(DEVICE_ID_KEY, id)
  return id
}

const LAST_DECK_ID_KEY = 'boarderoni-last-deck-id'

// Which deck this browser/WebView had open last — read once at launch (see
// App.tsx) so both the desktop editor and the mobile view client skip
// straight back into it instead of always landing on the picker.
export function getLastDeckId(): string | null {
  return localStorage.getItem(LAST_DECK_ID_KEY)
}

export function setLastDeckId(id: string): void {
  localStorage.setItem(LAST_DECK_ID_KEY, id)
}

// Called on an explicit "back to picker" (disconnect(), or the server
// rejecting a remembered id that no longer exists) — an intentional exit
// like that means the next launch should ask again, not silently reopen
// whatever was last open.
export function clearLastDeckId(): void {
  localStorage.removeItem(LAST_DECK_ID_KEY)
}

const KEEP_SCREEN_ON_KEY = 'boarderoni-keep-screen-on'

// Purely local to this device — not synced through the server like
// customName, since it's a hardware preference with no meaning to any other
// client. Only actually does anything inside the Android app (see
// androidBridge.ts); reading/writing it elsewhere is harmless no-op storage.
export function getKeepScreenOnPreference(): boolean {
  return localStorage.getItem(KEEP_SCREEN_ON_KEY) === '1'
}

export function setKeepScreenOnPreference(enabled: boolean): void {
  localStorage.setItem(KEEP_SCREEN_ON_KEY, enabled ? '1' : '0')
}

// Bumped to -v2 as a deliberate one-time reset: every properties-panel
// section should read as collapsed again for anyone who already has
// sections remembered as open under the old key, without giving up the
// remember-what-you-open behavior going forward (isSectionOpen below simply
// returns false for a key it's never seen, same as a first-time user). Do
// not revert this to the unversioned name.
const OPEN_SECTIONS_KEY = 'boarderoni-open-sections-v2'

// Which PropertiesSection headings the editor remembers as expanded — purely
// a local UI preference (not synced through the server), and deliberately
// keyed by the section's own title/id rather than per-widget: every section
// sharing a heading (e.g. every widget's own "Colors") shares one remembered
// state, which is the common/desired case, not a bug. Read fresh from
// localStorage on every call rather than cached in memory — this is a rare,
// user-driven write path (one toggle click), not a hot one.
function readOpenSections(): Set<string> {
  const raw = localStorage.getItem(OPEN_SECTIONS_KEY)
  return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
}

export function isSectionOpen(key: string): boolean {
  return readOpenSections().has(key)
}

export function setSectionOpen(key: string, open: boolean): void {
  const sections = readOpenSections()
  if (open) sections.add(key)
  else sections.delete(key)
  localStorage.setItem(OPEN_SECTIONS_KEY, JSON.stringify([...sections]))
}
