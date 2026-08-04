import type { WidgetAction } from './types'

// Short human-readable description of what a widget's action does, used as
// the deployed button's hover/long-press title.
export function actionTitle(action: WidgetAction): string {
  return action.kind === 'keypress' ? action.keys.join(' + ') : 'Update state'
}
