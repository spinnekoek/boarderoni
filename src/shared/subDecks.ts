import { DEFAULT_GRID_SIZE, DEFAULT_CANVAS_WIDTH, DEFAULT_CANVAS_HEIGHT } from './constants'
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

// Read/write-side pair for a view's own gridSize — same "main deck vs. named
// sub-deck" split as getSubDeckWidgets/setSubDeckWidgets above, just for one
// number instead of the whole widget array. Falls back to
// DEFAULT_GRID_SIZE, never undefined, so every caller (Toolbar's input,
// CanvasWidget/MorphCanvasWidget/useWidgetDrag's snap math,
// useEditorShortcuts' nudge step) can use the result directly with no `??`
// of its own.
export function getSubDeckGridSize(source: Pick<Dashboard, 'gridSize' | 'subDecks'>, subDeckId: string | null | undefined): number {
  if (!subDeckId) return source.gridSize ?? DEFAULT_GRID_SIZE
  return findSubDeck(source, subDeckId)?.gridSize ?? DEFAULT_GRID_SIZE
}

export function setSubDeckGridSize(dashboard: Dashboard, subDeckId: string | null | undefined, gridSize: number): Dashboard {
  if (!subDeckId) return { ...dashboard, gridSize }
  if (!findSubDeck(dashboard, subDeckId)) return dashboard
  return {
    ...dashboard,
    subDecks: (dashboard.subDecks ?? []).map((sd) => (sd.id === subDeckId ? { ...sd, gridSize } : sd))
  }
}

// Read/write-side pair for a view's own reference canvas size — same
// "main deck vs. named sub-deck" split as getSubDeckGridSize/
// setSubDeckGridSize above. Falls back to DEFAULT_CANVAS_WIDTH/HEIGHT, never
// undefined, so ClientCanvas.tsx's letterboxing math can use the result
// directly with no `??` of its own.
export function getSubDeckCanvasSize(
  source: Pick<Dashboard, 'canvasWidth' | 'canvasHeight' | 'subDecks'>,
  subDeckId: string | null | undefined
): { width: number; height: number } {
  const target = subDeckId ? findSubDeck(source, subDeckId) : source
  return { width: target?.canvasWidth ?? DEFAULT_CANVAS_WIDTH, height: target?.canvasHeight ?? DEFAULT_CANVAS_HEIGHT }
}

export function setSubDeckCanvasSize(dashboard: Dashboard, subDeckId: string | null | undefined, width: number, height: number): Dashboard {
  if (!subDeckId) return { ...dashboard, canvasWidth: width, canvasHeight: height }
  if (!findSubDeck(dashboard, subDeckId)) return dashboard
  return {
    ...dashboard,
    subDecks: (dashboard.subDecks ?? []).map((sd) => (sd.id === subDeckId ? { ...sd, canvasWidth: width, canvasHeight: height } : sd))
  }
}

function widgetsEqual(a: Widget, b: Widget): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

// Keeps the OLD reference for every widget whose content is unchanged
// between syncs, rather than the brand-new object JSON.parse always hands
// back — a drag tick only actually changes the widget(s) being dragged, but
// naively taking the incoming array wholesale gives every OTHER widget on
// the same screen a new reference too. That defeats ClientWidget/CanvasWidget's
// own React.memo (see ClientCanvas.tsx), forcing every widget on screen to
// re-render on every single tick of someone else's drag — the more widgets
// on a screen, the worse. Falls back to the old array's own reference too
// when literally nothing in it changed, so a caller's useMemo one level up
// (e.g. ClientCanvas's `widgets`) can skip work as well.
function reconcileWidgetList(oldWidgets: Widget[], newWidgets: Widget[]): Widget[] {
  const oldById = new Map(oldWidgets.map((w) => [w.id, w]))
  let changed = oldWidgets.length !== newWidgets.length
  const reconciled = newWidgets.map((w) => {
    const old = oldById.get(w.id)
    if (old && widgetsEqual(old, w)) return old
    changed = true
    return w
  })
  return changed ? reconciled : oldWidgets
}

// Reconciles an incoming dashboard:sync payload against the previously-held
// dashboard, applying reconcileWidgetList to the main deck's widgets and
// every sub-deck's — see its own comment for why. Called from store.ts's
// message handler in place of taking `message.dashboard` as-is.
export function reconcileDashboard(oldDashboard: Dashboard, newDashboard: Dashboard): Dashboard {
  const widgets = reconcileWidgetList(oldDashboard.widgets, newDashboard.widgets)
  const oldSubDecksById = new Map((oldDashboard.subDecks ?? []).map((sd) => [sd.id, sd]))
  let subDecksChanged = (oldDashboard.subDecks?.length ?? 0) !== (newDashboard.subDecks?.length ?? 0)
  const subDecks = (newDashboard.subDecks ?? []).map((sd) => {
    const old = oldSubDecksById.get(sd.id)
    // gridSize/canvasWidth/canvasHeight checked alongside name — same
    // reasoning: all plain fields on the sub-deck object itself (not inside
    // `widgets`), so a change to any of them has to force a fresh object
    // through, or the old one would keep getting returned below and the
    // update would silently drop.
    if (!old || old.name !== sd.name || old.gridSize !== sd.gridSize || old.canvasWidth !== sd.canvasWidth || old.canvasHeight !== sd.canvasHeight) {
      subDecksChanged = true
      return sd
    }
    const reconciledWidgets = reconcileWidgetList(old.widgets, sd.widgets)
    if (reconciledWidgets === old.widgets) return old
    subDecksChanged = true
    return { ...sd, widgets: reconciledWidgets }
  })
  return { ...newDashboard, widgets, subDecks: subDecksChanged ? subDecks : (oldDashboard.subDecks ?? []) }
}

// Every widget in the dashboard, root deck plus every sub-deck, flattened
// into one array — for callers that need to scan the whole deck rather than
// address one specific view (e.g. export's collectImportWarnings/
// stripMachineSpecificFields in main/index.ts). Same traversal
// loadDeckDashboard/migrateLegacyDashboard already do inline when migrating
// every widget list; kept here as its own reusable helper instead of a
// third copy of that loop.
export function allDeckWidgets(dashboard: Pick<Dashboard, 'widgets' | 'subDecks'>): Widget[] {
  return [...dashboard.widgets, ...(dashboard.subDecks ?? []).flatMap((sd) => sd.widgets)]
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
