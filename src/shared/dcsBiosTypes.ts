// Plain data shapes for the DCS-BIOS plugin — no Node APIs, so the
// renderer can import this directly (same reasoning as shared/plugins.ts).
// Shared by the worker (src/main/dcsBios/worker.ts), the main-thread
// connection manager, the WS message types (shared/types.ts), and the
// renderer's store/UI.

export type DcsBiosValueType = 'integer' | 'string'

// One mappable field of an aircraft's control set, flattened from DCS-BIOS's
// own per-aircraft JSON doc (see BiosControl/BiosOutput in the plan's
// protocol notes). Deliberately drops Inputs/Deprecated/Color — out of scope
// for a read-only mapping UI; see DcsBiosCommandCatalogEntry for Inputs.
export interface DcsBiosFieldCatalogEntry {
  // Control identifier, or "<identifier>.<suffix>" when a control has more
  // than one output — unique within an aircraft, used directly as
  // PluginMapping.field.
  key: string
  label: string
  category: string
  valueType: DcsBiosValueType
  address: number
  mask?: number
  shiftBy?: number
  maxValue?: number
  maxLength?: number
}

// The four input interfaces DCS-BIOS actually documents (confirmed against
// the real userguide.adoc "Input Interfaces" section, not guessed) — no
// "set_string" despite some DCS-BIOS-Communicator naming suggesting one.
// One control can expose more than one of these (e.g. a switch commonly has
// both `action` (a fixed TOGGLE) and `set_state` (an explicit position)) —
// each interface a control exposes becomes its own selectable "command"
// entry, since the value each one expects differs completely.
export type DcsBiosInputInterface = 'set_state' | 'fixed_step' | 'action' | 'variable_step'

// One command a widget's "Send DCS command" action (shared/types.ts's
// SendDcsCommandAction) can target — one (identifier, interface) pair.
// Wire format (confirmed): "<identifier> <argument>\n" sent as UDP to
// DcsBiosSettings.sendPort. What `argument` should look like depends on
// `interface`:
//   set_state:    a number, 0..maxValue
//   fixed_step:   the literal string "INC" or "DEC"
//   action:       the fixed `argument` value below (e.g. "TOGGLE") — not
//                 user-choosable, this interface only ever has one valid
//                 argument
//   variable_step: "+NUMBER" or "-NUMBER" — `suggestedStep` is a sane
//                 starting magnitude (DCS-BIOS's own default is 3200),
//                 not a hard limit
export interface DcsBiosCommandCatalogEntry {
  identifier: string
  label: string
  category: string
  interface: DcsBiosInputInterface
  maxValue?: number // set_state, variable_step
  suggestedStep?: number // variable_step
  argument?: string // action
}

// `connected` means "received DCS-BIOS UDP traffic recently," not "socket is
// open" — UDP is connectionless, so a bound socket says nothing about
// whether DCS is actually running. `everConnected` distinguishes "never seen
// a packet this session" from "was receiving data, now silent."
export interface DcsBiosStatus {
  connected: boolean
  everConnected: boolean
  activeAircraft: string | null
}

// Diagnostic-only — answers "is the worker itself keeping up with DCS's raw
// output," independent of anything a consumer chooses to do with the data
// downstream (see DcsBiosSettings.defaultUpdateHz / a source's own
// config.updateHz, which control a different, fully separate rate).
export interface DcsBiosWorkerStats {
  packetsPerSec: number
  writesPerSec: number
  eventLoopDelayMeanMs: number
  eventLoopDelayMaxMs: number
  lastBatchFieldCount: number
}

// Persisted connection profile. sendPort is the UDP port "Send DCS command"
// actions broadcast to (see SendDcsCommandAction in shared/types.ts).
// defaultUpdateHz seeds new dcsbios sources' per-instance update-frequency
// slider.
export interface DcsBiosSettings {
  docsDir: string
  multicastAddress: string
  multicastPort: number
  sendPort: number
  defaultUpdateHz: number
}
