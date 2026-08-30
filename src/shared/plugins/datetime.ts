import type { PluginTypeMeta } from './types'

// Computed in the main process's local timezone (plain `Date`) — same
// "resolved server-side" model update-state actions already use. A device
// in a different timezone than the host sees the host's time, not its own.
// Producer: main/plugins/datetime.ts.
export const datetimePlugin: PluginTypeMeta = {
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
}
