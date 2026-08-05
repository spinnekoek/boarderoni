import type { ColorAppearance, Variable, VariableValue, WidgetLabel } from './types'
import { pickLegibleTextColor } from './color'

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

export interface ResolvedColor {
  color?: string
  // Already converted to the internal 0-1 scale used everywhere else (see
  // withOpacity in shared/color.ts) — undefined means the expression didn't
  // return one, so the caller should fall back to its own opacity field
  // (backgroundOpacity/borderOpacity) same as before this existed.
  opacity?: number
}

// A colorExpr/borderColorExpr can return either a plain hex string (sets
// just the color) or an object like { color: '#ff0000', opacity: 70 } to
// set both from one expression. `opacity` here is 0-100, matching how the
// properties panel's slider shows and edits it — not the 0-1 scale used
// internally — so a lay expression author writes the same number they'd
// otherwise drag the slider to.
function evaluateColorExpression(expr: string, variables: VariableMap): ResolvedColor {
  const result = tryEvaluateExpression(expr, variables)
  if (!result.ok) return {}
  if (typeof result.value === 'string') return { color: result.value }
  if (result.value && typeof result.value === 'object') {
    const obj = result.value as Record<string, unknown>
    return {
      color: typeof obj.color === 'string' ? obj.color : undefined,
      opacity: typeof obj.opacity === 'number' ? obj.opacity / 100 : undefined
    }
  }
  return {}
}

// This box's effective fill color (+ optional opacity override) for the
// given variables: colorExpr evaluated where set, falling back to the plain
// `color` field for whichever part the expression didn't return (a missing
// key, an error, or a value of the wrong type all land here the same way —
// never treated as an explicit "clear this to nothing").
export function resolveColor(box: ColorAppearance, variables: VariableMap): ResolvedColor {
  if (!box.colorExpr) return { color: box.color }
  const resolved = evaluateColorExpression(box.colorExpr, variables)
  return { color: resolved.color ?? box.color, opacity: resolved.opacity }
}

// Same idea as resolveColor, but for the border — independent of colorExpr,
// since a widget's fill and border can each be static or expression-driven
// on their own.
export function resolveBorderColor(box: ColorAppearance, variables: VariableMap): ResolvedColor {
  if (!box.borderColorExpr) return { color: box.borderColor }
  const resolved = evaluateColorExpression(box.borderColorExpr, variables)
  return { color: resolved.color ?? box.borderColor, opacity: resolved.opacity }
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

// This label's effective text color (+ optional opacity override) against
// the widget's background — same idea as resolveColor/resolveBorderColor,
// but the "no explicit choice" fallback is pickLegibleTextColor(background)
// rather than a fixed default, matching the label's own Auto behavior.
export function resolveTextColor(
  label: WidgetLabel,
  backgroundColor: string,
  variables: VariableMap
): { color: string; opacity?: number } {
  const fallback = label.textColor ?? pickLegibleTextColor(backgroundColor)
  if (!label.textColorExpr) return { color: fallback }
  const resolved = evaluateColorExpression(label.textColorExpr, variables)
  return { color: resolved.color ?? fallback, opacity: resolved.opacity }
}
