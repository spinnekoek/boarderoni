import type { EventfulWidget, SequenceStep, WidgetEventKind } from './types'

export const EVENT_LABELS: Record<WidgetEventKind, string> = {
  press: 'Press',
  release: 'Release',
  move: 'Move',
  increment: 'Turn CW (increment)',
  decrement: 'Turn CCW (decrement)',
  // Never actually iterated (see eventKindsFor/getEventSteps below,
  // MultiSwitchWidget isn't an EventfulWidget) — present only so this stays a
  // total Record over WidgetEventKind.
  select: 'Select'
}

// Which WidgetEventKind values apply to this widget's type, in display/
// iteration order. AdjusterWidget adds 'move'; EncoderWidget swaps 'move' for
// 'increment'/'decrement'. Button/Morph only ever fire on press/release.
export function eventKindsFor(widget: EventfulWidget): WidgetEventKind[] {
  if (widget.type === 'adjuster') return ['press', 'release', 'move']
  if (widget.type === 'encoder') return ['press', 'release', 'increment', 'decrement']
  return ['press', 'release']
}

// Looks up one event's step list. Returns undefined for an event this
// widget's type doesn't support (e.g. 'move' on a Button) — lets
// triggerAction (main/index.ts) treat a stale/malformed action:trigger as a
// clean error instead of a crash, and lets actionTitle skip it silently.
export function getEventSteps(widget: EventfulWidget, event: WidgetEventKind): SequenceStep[] | undefined {
  if (event === 'move') return widget.type === 'adjuster' ? widget.events.move : undefined
  if (event === 'increment' || event === 'decrement') return widget.type === 'encoder' ? widget.events[event] : undefined
  if (event === 'select') return undefined
  return widget.events[event]
}
