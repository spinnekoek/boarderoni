import type { PluginTypeMeta } from './types'

// Fields are dynamic — depend on what's installed on this machine and which
// aircraft module is picked (see EventSourcesModal.tsx's field browser and
// main/dcsBios/*). This static entry only exists so the kind shows up in the
// "Add event source" picker; the main-process producer lives in
// main/plugins/dcsbios.ts, keyed by config.aircraft, not by any field list
// here. Its config UI (aircraft/update-rate picker, field browser) lives in
// renderer/src/plugins/DcsBiosConfigPanel.tsx.
export const dcsbiosPlugin: PluginTypeMeta = {
  kind: 'dcsbios',
  label: 'DCS-BIOS',
  fields: [],
  dynamicFields: true
}
