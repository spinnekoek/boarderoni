import { create } from 'zustand'

interface ExpansionCommand {
  open: boolean
  // Incremented on every broadcast, not just a plain boolean — so clicking
  // "Collapse all" twice in a row (nothing toggled in between) still
  // re-applies instead of looking like a no-op change to a PropertiesSection
  // already sitting at `open: false` from a manual toggle.
  id: number
}

interface PropertiesExpansionState {
  command: ExpansionCommand | null
}

// Broadcasts "open"/"closed" to every currently-mounted PropertiesSection at
// once (see its own useEffect in PropertiesPanel.tsx) — the properties
// panel's own "Expand all"/"Collapse all" header buttons. A section mounted
// AFTER a broadcast just keeps its own persisted isSectionOpen default
// (see id.ts) rather than retroactively reacting to a stale click from
// before it existed.
export const usePropertiesExpansionStore = create<PropertiesExpansionState>(() => ({ command: null }))

export function expandAllSections(): void {
  usePropertiesExpansionStore.setState((s) => ({ command: { open: true, id: (s.command?.id ?? 0) + 1 } }))
}

export function collapseAllSections(): void {
  usePropertiesExpansionStore.setState((s) => ({ command: { open: false, id: (s.command?.id ?? 0) + 1 } }))
}
