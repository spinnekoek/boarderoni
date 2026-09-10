import { isMorphSliderActive } from './morph'
import type { EventfulWidget, SequenceStep, WidgetEventKind } from './types'

export const EVENT_LABELS: Record<WidgetEventKind, string> = {
  press: 'Press',
  release: 'Release',
  doublePress: 'Double press',
  triplePress: 'Triple press',
  move: 'Move',
  increment: 'Turn CW (increment)',
  decrement: 'Turn CCW (decrement)',
  // Never actually iterated (see eventKindsFor/getEventSteps below,
  // MultiSwitchWidget isn't an EventfulWidget) — present only so this stays a
  // total Record over WidgetEventKind.
  select: 'Select',
  positionChange: 'Position Change',
  guardToggle: 'Guard Press'
}

// Which WidgetEventKind values apply to this widget's type, in display/
// iteration order. AdjusterWidget adds 'move'; EncoderWidget swaps 'move' for
// 'increment'/'decrement'. A morph button adds 'move' too, but only once its
// shape actually supports a slider (see isMorphSliderActive) — plain
// Button/Morph otherwise only ever fire on press/release.
export function eventKindsFor(widget: EventfulWidget): WidgetEventKind[] {
  if (widget.type === 'adjuster-slider' || widget.type === 'adjuster-knob') return ['press', 'release', 'doublePress', 'triplePress', 'move']
  if (widget.type === 'encoder') return ['press', 'release', 'doublePress', 'triplePress', 'increment', 'decrement']
  if (widget.type === 'morph' && isMorphSliderActive(widget)) return ['press', 'release', 'move']
  if (widget.type === 'button') return ['press', 'release', 'doublePress', 'triplePress']
  return ['press', 'release']
}

// Looks up one event's step list. Returns undefined for an event this
// widget's type doesn't support (e.g. 'move' on a Button) — lets
// triggerAction (main/index.ts) treat a stale/malformed action:trigger as a
// clean error instead of a crash, and lets actionTitle skip it silently.
export function getEventSteps(widget: EventfulWidget, event: WidgetEventKind): SequenceStep[] | undefined {
  if (event === 'move') {
    if (widget.type === 'adjuster-slider' || widget.type === 'adjuster-knob') return widget.events.move
    if (widget.type === 'morph' && isMorphSliderActive(widget)) return widget.events.move ?? []
    return undefined
  }
  if (event === 'increment' || event === 'decrement') return widget.type === 'encoder' ? widget.events[event] : undefined
  if (event === 'doublePress' || event === 'triplePress') {
    return widget.type === 'button' || widget.type === 'adjuster-slider' || widget.type === 'adjuster-knob' || widget.type === 'encoder'
      ? widget.events[event]
      : undefined
  }
  if (event === 'select') return undefined
  return widget.events[event]
}

// Recursively expands every step, including ones nested inside a
// ConditionStep's whenTrue/whenFalse branches, into one flat list — order
// doesn't matter for callers of this (currently just collectImportWarnings'
// "does a call-rest action reachable from this widget reference a stale
// data source" scan), only "is this step reachable at all from this widget".
export function flattenSequenceSteps(steps: SequenceStep[]): SequenceStep[] {
  return steps.flatMap((step) => (step.kind === 'condition' ? [step, ...flattenSequenceSteps(step.whenTrue), ...flattenSequenceSteps(step.whenFalse)] : [step]))
}
