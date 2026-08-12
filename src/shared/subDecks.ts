import type { Dashboard, SubDeck, Widget } from './types'

export function findSubDeck(source: Pick<Dashboard, 'subDecks'>, subDeckId: string): SubDeck | undefined {
  return source.subDecks?.find((sd) => sd.id === subDeckId)
}

// The widget array for one deck view — null/undefined for the main deck,
// or a specific sub-deck's own id. Falls back to the main deck's widgets if
// subDeckId no longer names a real sub-deck (e.g. deleted out from under a
// client that was viewing/editing it) rather than throwing or returning
// something that reads as "blank dashboard".
export function getSubDeckWidgets(
  source: Pick<Dashboard, 'widgets' | 'subDecks'>,
  subDeckId: string | null | undefined
): Widget[] {
  if (!subDeckId) return source.widgets
  return findSubDeck(source, subDeckId)?.widgets ?? source.widgets
}

// Write-side counterpart — returns a NEW Dashboard with the given view's
// widget array replaced. Writing to a subDeckId that no longer exists is a
// no-op (returns dashboard unchanged) rather than silently recreating a
// deleted sub-deck.
export function setSubDeckWidgets(dashboard: Dashboard, subDeckId: string | null | undefined, widgets: Widget[]): Dashboard {
  if (!subDeckId) return { ...dashboard, widgets }
  if (!findSubDeck(dashboard, subDeckId)) return dashboard
  return {
    ...dashboard,
    subDecks: (dashboard.subDecks ?? []).map((sd) => (sd.id === subDeckId ? { ...sd, widgets } : sd))
  }
}

// Finds a widget by id regardless of which deck view it lives on — main
// deck first, then each sub-deck. Safe/unambiguous because widget ids are
// global across the whole Dashboard (see nextId() in renderer/src/id.ts —
// every widget everywhere, on every view, is minted from the same id
// pool). Used wherever a widgetId arrives with no indication of which view
// it's actually on (triggerAction, the action:error toast handler, ...).
export function findWidgetAnywhere(dashboard: Dashboard, widgetId: string): Widget | undefined {
  const inMain = dashboard.widgets.find((w) => w.id === widgetId)
  if (inMain) return inMain
  for (const subDeck of dashboard.subDecks ?? []) {
    const found = subDeck.widgets.find((w) => w.id === widgetId)
    if (found) return found
  }
  return undefined
}
