import { DcsBiosSettingsPanel } from './components/DcsBiosSettingsPanel'

// Registry of per-kind settings panels, keyed by EventSourceTypeMeta.kind
// (see shared/eventSources.ts). A kind with nothing to configure (e.g.
// 'datetime') simply has no entry here — SettingsModal.tsx only renders an
// expandable panel for kinds present in this map. This is the actual
// extension point for a future high-intensity data source: add an
// EVENT_SOURCE_TYPES entry, optionally a producer, and optionally one line
// here — nothing else in the Settings page needs to change.
export const DATA_SOURCE_SETTINGS_PANELS: Partial<Record<string, React.ComponentType>> = {
  dcsbios: DcsBiosSettingsPanel
}
