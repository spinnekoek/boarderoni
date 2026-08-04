import type { ColorAppearance, Variable, VariableValue, WidgetLabel } from './types'

export type VariableMap = Record<string, VariableValue>

export function toVariableMap(variables: Variable[]): VariableMap {
  const map: VariableMap = {}
  for (const v of variables) map[v.name] = v.value
  return map
}

export type ExpressionResult = { ok: true; value: unknown } | { ok: false; error: string }

// Evaluates a bindable expression's code as a function body with `variables`
// in scope. Plain `new Function` — no Node/Electron/DOM APIs assumed by the
// mechanism itself — so this behaves identically wherever it runs: the main
// process (evaluating an update-state action) and every renderer (desktop
// editor preview + deployed Android WebView) resolving a colorExpr/textExpr
// binding. A thrown error (syntax error, bad reference, whatever the code
// does) is caught here rather than left to crash whatever's evaluating it.
export function tryEvaluateExpression(code: string, variables: VariableMap): ExpressionResult {
  try {
    const fn = new Function('variables', code) as (variables: VariableMap) => unknown
    return { ok: true, value: fn(variables) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// This box's effective fill color for the given variables: colorExpr
// evaluated (falling back to the plain `color` field if the expression
// errors or doesn't return a string) where set, else just `color`.
export function resolveColor(box: ColorAppearance, variables: VariableMap): string | undefined {
  if (box.colorExpr) {
    const result = tryEvaluateExpression(box.colorExpr, variables)
    if (result.ok && typeof result.value === 'string') return result.value
  }
  return box.color
}

// This label's effective display text — textExpr evaluated (coerced to a
// string) where set, else just `text`.
export function resolveLabelText(label: WidgetLabel, variables: VariableMap): string {
  if (label.textExpr) {
    const result = tryEvaluateExpression(label.textExpr, variables)
    if (result.ok) return typeof result.value === 'string' ? result.value : String(result.value)
  }
  return label.text
}
