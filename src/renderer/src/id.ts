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

const VARIABLES_FILTER_KEY = 'boarderoni-variables-filter'

// Which tab/search/sort the Variables modal was left on — purely a local UI
// preference (not synced through the server). The modal itself is unmounted
// on close (see Toolbar.tsx's `{variablesOpen && <VariablesModal .../>}`),
// so without this its search/tab/sort would silently reset every time it's
// reopened. `tab` empty means "unset" — VariablesModal.tsx falls back to its
// own CUSTOM_TAB default (and separately resets it if it names a source
// that's since been removed), same as a first-time user with nothing stored.
// `sort` defaults to 'name' — the list's original (and only) behavior before
// 'recent' existed, so anyone with a filter blob saved from before this field
// existed keeps seeing exactly what they always have.
export function getVariablesFilter(): { search: string; tab: string; sort: 'name' | 'recent' } {
  const raw = localStorage.getItem(VARIABLES_FILTER_KEY)
  if (!raw) return { search: '', tab: '', sort: 'name' }
  try {
    const parsed = JSON.parse(raw) as { search?: string; tab?: string; sort?: string }
    return { search: parsed.search ?? '', tab: parsed.tab ?? '', sort: parsed.sort === 'recent' ? 'recent' : 'name' }
  } catch {
    return { search: '', tab: '', sort: 'name' }
  }
}

export function setVariablesFilter(filter: { search: string; tab: string; sort: 'name' | 'recent' }): void {
  localStorage.setItem(VARIABLES_FILTER_KEY, JSON.stringify(filter))
}

const IGNORED_VARIABLE_IDS_KEY = 'boarderoni-ignored-variable-ids'

// Variable ids currently silenced from 'recent' sort's "just changed" bucket
// (VariablesModal.tsx's ignoredIds) — persisted across modal closes/app
// restarts like the filter above, not just kept in memory. Stale ids (a
// variable since deleted, or from a different dashboard entirely — this
// isn't scoped per-deck) are harmless: nothing currently matches them, they
// just sit unused until manually cleared via "Clear ignores."
export function getIgnoredVariableIds(): string[] {
  const raw = localStorage.getItem(IGNORED_VARIABLE_IDS_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function setIgnoredVariableIds(ids: string[]): void {
  localStorage.setItem(IGNORED_VARIABLE_IDS_KEY, JSON.stringify(ids))
}

const LAST_DCS_AIRCRAFT_KEY = 'boarderoni-last-dcs-aircraft'

// Which DCS-BIOS aircraft was last picked in ANY SendDcsCommandActionEditor,
// across every widget/event — purely a local UI convenience so a freshly
// added "Send DCS command" action starts pre-pointed at whichever aircraft
// you're actually working on, instead of always starting blank at "Pick an
// aircraft…" regardless of how many you've already wired up elsewhere in
// the same dashboard.
export function getLastDcsAircraft(): string {
  return localStorage.getItem(LAST_DCS_AIRCRAFT_KEY) ?? ''
}

export function setLastDcsAircraft(aircraft: string): void {
  localStorage.setItem(LAST_DCS_AIRCRAFT_KEY, aircraft)
}
