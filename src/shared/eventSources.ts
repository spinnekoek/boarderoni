// Declarative metadata for every event-source kind — no logic, just what the
// renderer needs to render the "pick a kind" / "pick a field" pickers (see
// EventsModal.tsx). Kept here (not in main/eventSourceProducers.ts) so the
// renderer can import it without pulling in any Node-specific code; the
// main-process producer for each kind (see main/eventSourceProducers.ts)
// must emit exactly the field keys listed here.
export interface EventSourceField {
  key: string
  label: string
}

export interface EventSourceTypeMeta {
  kind: string
  label: string
  fields: EventSourceField[]
  // True when this kind's fields aren't statically known (see 'dcsbios') —
  // EventsModal.tsx checks this to render a dynamic aircraft/field-browser
  // UI instead of the generic static-list field picker. An explicit flag
  // rather than inferring from `fields.length === 0`, since an empty array
  // is ambiguous (could just mean "not configured yet" for a still-static
  // kind added later).
  dynamicFields?: boolean
}

// Computed in the main process's local timezone (plain `Date`) — same
// "resolved server-side" model update-state actions already use. A device
// in a different timezone than the host sees the host's time, not its own.
export const EVENT_SOURCE_TYPES: EventSourceTypeMeta[] = [
  {
    kind: 'datetime',
    label: 'Date & Time',
    fields: [
      { key: 'hour24', label: 'Hour (24h)' },
      { key: 'hour12', label: 'Hour (12h)' },
      { key: 'minute', label: 'Minute' },
      { key: 'second', label: 'Second' },
      { key: 'secondHalf', label: 'Second + half (e.g. 12.5)' },
      { key: 'ampm', label: 'AM/PM' },
      { key: 'dayOfWeek', label: 'Day of week (number, 0=Sunday)' },
      { key: 'dayOfWeekName', label: 'Day of week (name)' },
      { key: 'day', label: 'Day of month' },
      { key: 'month', label: 'Month (number)' },
      { key: 'monthName', label: 'Month (name)' },
      { key: 'year', label: 'Year' },
      { key: 'date', label: 'Date (YYYY-MM-DD)' },
      { key: 'time', label: 'Time (HH:MM:SS)' },
      { key: 'iso', label: 'ISO 8601 timestamp' },
      { key: 'unixMs', label: 'Unix timestamp (ms)' },
      { key: 'unixSeconds', label: 'Unix timestamp (s)' }
    ]
  },
  // Fields are dynamic — depend on what's installed on this machine and
  // which aircraft module is picked (see EventsModal.tsx's field browser
  // and main/dcsBios/*). This static entry only exists so the kind shows up
  // in the "add event source" picker; the main-process producer lives in
  // main/eventSourceProducers.ts, keyed by config.aircraft, not by any
  // field list here.
  {
    kind: 'dcsbios',
    label: 'DCS-BIOS',
    fields: [],
    dynamicFields: true
  }
]

export function getEventSourceType(kind: string): EventSourceTypeMeta | undefined {
  return EVENT_SOURCE_TYPES.find((t) => t.kind === kind)
}
