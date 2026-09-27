import { create } from 'zustand'
import { useDashboardStore } from './store'
import { nextId } from './id'
import type { SubDeck, Widget } from '@shared/types'

// Pixel offset applied per paste (compounding with paste count), so pasting
// the same clipboard repeatedly fans copies out instead of stacking them
// exactly on top of each other and their source.
const PASTE_OFFSET = 24

// Exported for Palette.tsx's own custom-variant spawn logic — regenerating
// every nested id (labels/positions/states) the same way a pasted widget
// needs to is exactly what dropping a saved CustomVariant back onto the
// canvas needs too, so it reuses this rather than duplicating the per-type
// switch below. `findSourceSubDeck` resolves a window widget's own nested
// SubDeck (see the 'window' case below) — defaults to looking it up in the
// CURRENTLY OPEN dashboard, which is correct for same-deck use (a normal
// paste, or a custom variant spawned in the deck it was saved from) but
// would silently find nothing — and clone an empty window — if the widget
// came from a DIFFERENT deck than the one open right now (its subDeckId
// only ever existed in the original deck's own subDecks array). The
// clipboard store below passes its own snapshot instead, taken at copy()
// time rather than looked up live at paste() time, specifically so a
// copy-in-deck-A-paste-into-deck-B round trip (switching decks in between)
// still carries the window's real content instead of losing it.
export function cloneWidget(
  widget: Widget,
  offset: number,
  findSourceSubDeck: (subDeckId: string) => SubDeck | undefined = (id) => useDashboardStore.getState().dashboard.subDecks?.find((sd) => sd.id === id)
): Widget {
  if (
    widget.type === 'gauge-bar' ||
    widget.type === 'gauge-arc' ||
    widget.type === 'adjuster-slider' ||
    widget.type === 'adjuster-knob' ||
    widget.type === 'encoder'
  ) {
    return {
      ...widget,
      id: nextId(),
      x: widget.x + offset,
      y: widget.y + offset,
      // A pasted/duplicated widget starts ungrouped — without this it would
      // silently inherit the source's groupId and join the same group,
      // making the original drag the unrelated copy along with it (see
      // groupId's own comment in shared/types.ts).
      groupId: undefined,
      labels: widget.labels.map((label) => ({ ...label, id: nextId() }))
    }
  }

  if (widget.type === 'switch-rocker' || widget.type === 'switch-dial' || widget.type === 'switch-toggle' || widget.type === 'dropdown') {
    return {
      ...widget,
      id: nextId(),
      x: widget.x + offset,
      y: widget.y + offset,
      groupId: undefined,
      positions: widget.positions.map((position) => ({
        ...position,
        id: nextId(),
        labels: position.labels.map((label) => ({ ...label, id: nextId() }))
      }))
    }
  }

  // No nested labels/positions/states to regenerate ids for at all.
  if (widget.type === 'screen-capture' || widget.type === 'line') {
    return { ...widget, id: nextId(), x: widget.x + offset, y: widget.y + offset, groupId: undefined }
  }

  // Its own single label (not a labels[] array — see LabelWidget's own
  // comment in shared/types.ts), still needs a fresh id like every other
  // widget's own labels do.
  if (widget.type === 'label') {
    return {
      ...widget,
      id: nextId(),
      x: widget.x + offset,
      y: widget.y + offset,
      groupId: undefined,
      label: { ...widget.label, id: nextId() }
    }
  }

  // A window's own nested content is a real Dashboard.subDecks entry (see
  // WindowWidget.subDeckId's own comment in shared/types.ts), not embedded
  // on the widget itself — so cloning one has to mint and register an
  // entirely new SubDeck too (deep-cloning its own widgets, recursively
  // through this same function so THEIR nested labels/positions/states get
  // fresh ids as well), or two "copies" of a window would silently share
  // one subDeckId: editing either one's contents would edit both. The only
  // place in this file that reaches into the dashboard store directly
  // (every other branch above is a pure id-remap) — acceptable since this
  // is already called from paste(), which touches the store right
  // afterward anyway via pasteWidgets.
  if (widget.type === 'window') {
    // The SOURCE lookup goes through findSourceSubDeck (which may be a
    // cross-deck snapshot — see its own comment above) — but the freshly
    // minted subDeck is always registered into whichever dashboard is
    // CURRENTLY OPEN (the paste/variant-drop destination), via the live
    // store, regardless of where the source widget came from.
    const sourceSubDeck = findSourceSubDeck(widget.subDeckId)
    // Nested widgets keep their own relative position within the window's
    // own content coordinate space — 0 offset, not the paste/duplicate
    // offset the window widget itself gets below. No window can nest
    // inside another window's content (see the one-level-deep comment on
    // WindowWidget in shared/types.ts), so these never need their own
    // findSourceSubDeck — the default (unreachable for this recursive call)
    // is fine to leave implicit.
    const clonedWidgets = (sourceSubDeck?.widgets ?? []).map((w) => cloneWidget(w, 0))
    const newSubDeck: SubDeck = {
      id: nextId(),
      name: sourceSubDeck?.name ?? 'Window',
      widgets: clonedWidgets,
      gridSize: sourceSubDeck?.gridSize,
      canvasWidth: sourceSubDeck?.canvasWidth,
      canvasHeight: sourceSubDeck?.canvasHeight
    }
    const dashboard = useDashboardStore.getState().dashboard
    useDashboardStore.getState().updateDashboardMeta({ subDecks: [...(dashboard.subDecks ?? []), newSubDeck] })
    return { ...widget, id: nextId(), x: widget.x + offset, y: widget.y + offset, groupId: undefined, subDeckId: newSubDeck.id }
  }

  // Tracks old state id -> new state id so a morph widget's blocks (below)
  // can rekey their perState overrides onto the states they actually get
  // cloned alongside, instead of pointing at ids that no longer exist.
  const stateIdMap = new Map<string, string>()
  const states = widget.states.map((state) => {
    const newStateId = nextId()
    stateIdMap.set(state.id, newStateId)
    return { ...state, id: newStateId, labels: state.labels.map((label) => ({ ...label, id: nextId() })) }
  })

  if (widget.type === 'morph') {
    return {
      ...widget,
      id: nextId(),
      x: widget.x + offset,
      y: widget.y + offset,
      groupId: undefined,
      states,
      blocks: widget.blocks.map((block) => ({
        ...block,
        id: nextId(),
        perState: Object.fromEntries(
          Object.entries(block.perState).map(([stateId, override]) => [stateIdMap.get(stateId) ?? stateId, override])
        )
      }))
    }
  }

  return { ...widget, id: nextId(), x: widget.x + offset, y: widget.y + offset, groupId: undefined, states }
}

interface ClipboardStore {
  widgets: Widget[]
  // Snapshot of every copied window widget's own nested SubDeck, taken at
  // copy() time rather than looked up live at paste() time — see
  // cloneWidget's own findSourceSubDeck comment above for why: this
  // clipboard is a plain in-memory store that survives switching to a
  // DIFFERENT open deck before pasting, but the live dashboard doesn't —
  // its subDecks array is whatever deck is open right now, not the one the
  // copy came from. Keyed by the ORIGINAL subDeckId (stable at copy time,
  // before paste mints a new one).
  subDecks: Record<string, SubDeck>
  pasteCount: number
  copy: (widgets: Widget[]) => void
  paste: () => void
}

// Editor-local clipboard, shared between the keyboard shortcuts (Ctrl+C/V)
// and the right-click context menu — both just call these two actions
// instead of each keeping their own copy of "what's copied."
export const useClipboardStore = create<ClipboardStore>((set, get) => ({
  widgets: [],
  subDecks: {},
  pasteCount: 0,

  copy: (widgets) => {
    const dashboard = useDashboardStore.getState().dashboard
    const subDecks: Record<string, SubDeck> = {}
    for (const w of widgets) {
      if (w.type !== 'window') continue
      const subDeck = dashboard.subDecks?.find((sd) => sd.id === w.subDeckId)
      if (subDeck) subDecks[w.subDeckId] = subDeck
    }
    set({ widgets, subDecks, pasteCount: 0 })
  },

  paste: () => {
    const { widgets, subDecks, pasteCount } = get()
    if (widgets.length === 0) return
    const nextCount = pasteCount + 1
    const offset = PASTE_OFFSET * nextCount
    set({ pasteCount: nextCount })
    useDashboardStore.getState().pasteWidgets(widgets.map((w) => cloneWidget(w, offset, (id) => subDecks[id])))
  }
}))
