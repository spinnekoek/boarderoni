import type { EventfulWidget, SequenceStep, WidgetAction } from './types'
import { EVENT_LABELS, eventKindsFor, getEventSteps } from './widgetEvents'

function actionKindTitle(action: WidgetAction): string {
  switch (action.kind) {
    case 'none':
      return 'No action'
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
    case 'call-rest':
      // Generic, not resolving the target RestDataSource's name — same
      // precedent as 'send-dcs-command' above, which doesn't resolve its
      // aircraft either: actionTitle only receives the widget itself, no
      // external instance list to look a name up in.
      return 'Call REST'
  }
}

// Exported for reuse as the collapsed header title of a step row in the
// properties panel (PropertiesPanel.tsx) — same "reuse, don't duplicate the
// switch" reasoning as EVENT_LABELS. Deliberately non-recursive for
// 'condition': the hover tooltip below joins one event's steps with ' → '
// into a single line, which already implies a strict sequence — splicing in
// two branch sub-sequences would either read ambiguously (mixing "then" and
// "sequence" under the same arrow) or blow up in length a few levels of
// nesting deep. `If <expr>` is enough to say a fork exists on hover; the
// properties panel is where you inspect what each branch actually does.
export function stepTitle(step: SequenceStep): string {
  if (step.kind === 'delay') return `Wait ${step.delayMs}ms`
  if (step.kind === 'condition') return `If ${step.condition.trim() || '…'}`
  return actionKindTitle(step.action)
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
