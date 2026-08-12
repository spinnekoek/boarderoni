import type { EventfulWidget, SequenceStep, WidgetAction } from './types'
import { EVENT_LABELS, eventKindsFor, getEventSteps } from './widgetEvents'

function actionKindTitle(action: WidgetAction): string {
  switch (action.kind) {
    case 'keypress': {
      const modeSuffix = action.mode && action.mode !== 'press' ? ` (${action.mode})` : ''
      return action.keys.join(' + ') + modeSuffix
    }
    case 'update-state':
      return 'Update state'
    case 'send-dcs-command':
      return 'Send DCS command'
    case 'navigate-subdeck':
      return 'Navigate to screen'
    case 'open-overlay':
      return 'Open overlay'
    case 'close-overlay':
      return 'Close overlay'
  }
}

function stepTitle(step: SequenceStep): string {
  return step.kind === 'delay' ? `Wait ${step.delayMs}ms` : actionKindTitle(step.action)
}

// Short human-readable summary of everything a widget's events will do, used
// as the deployed button's hover/long-press title. An event with an empty
// sequence is omitted entirely.
export function actionTitle(widget: EventfulWidget): string {
  const parts = eventKindsFor(widget)
    .map((event) => ({ event, steps: getEventSteps(widget, event) ?? [] }))
    .filter(({ steps }) => steps.length > 0)
    .map(({ event, steps }) => `${EVENT_LABELS[event]}: ${steps.map(stepTitle).join(' → ')}`)
  return parts.length > 0 ? parts.join('  ·  ') : 'No action configured'
}
