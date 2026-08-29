import type { ColorAppearance, Variable, VariableValue, WidgetLabel, WidgetVisibility } from './types'
import { pickLegibleTextColor } from './color'

export type VariableMap = Record<string, VariableValue>

export function toVariableMap(variables: Variable[]): VariableMap {
  const map: VariableMap = {}
  for (const v of variables) map[v.name] = v.value
  return map
}

export type ExpressionResult = { ok: true; value: unknown } | { ok: false; error: string }

// Lets a host (the desktop editor's debug console panel) receive whatever an
// expression's own `console.log(...)` calls pass, without this shared module
// depending on any renderer-only store — the host just calls
// setExpressionConsoleSink once, e.g. wiring it up (or tearing it down) as
// its own debug panel opens/closes. Unset (the default, and always the case
// in the main process and the deployed view client, neither of which has a
// panel to show it in) makes every call below a no-op.
export type ExpressionConsoleSink = (args: unknown[]) => void
let consoleSink: ExpressionConsoleSink | null = null
export function setExpressionConsoleSink(sink: ExpressionConsoleSink | null): void {
  consoleSink = sink
}

// Shadows the real global `console` inside evaluated expression code (see
// the extra 'console' parameter below) — an expression's console.log never
// reaches this process's own devtools/stdout, only wherever the current sink
// forwards it.
const exprConsole = {
  log: (...args: unknown[]) => consoleSink?.(args)
}

// Evaluates a bindable expression's code as a function body with `variables`
// (and `console`, see exprConsole above) in scope. Plain `new Function` — no
// Node/Electron/DOM APIs assumed by the mechanism itself — so this behaves
// identically wherever it runs: the main process (evaluating an update-state
// action) and every renderer (desktop editor preview + deployed Android
// WebView) resolving a colorExpr/textExpr binding. A thrown error (syntax
// error, bad reference, whatever the code does) is caught here rather than
// left to crash whatever's evaluating it.
export function tryEvaluateExpression(code: string, variables: VariableMap): ExpressionResult {
  try {
    const fn = new Function('variables', 'console', code) as (variables: VariableMap, console: typeof exprConsole) => unknown
    return { ok: true, value: fn(variables, exprConsole) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// Evaluates an event-source mapping's transform expression with the raw
// field value exposed as `variables.$value`, alongside every existing
// Variable. `$value` is a reserved key deliberately unlikely to collide with
// a real variable name — a bare `value` key would silently shadow an actual
// Variable named "value" inside this one expression (unreachable, no error,
// just wrong data). `index`, when given, is exposed the same way as
// `variables.$index` — a SwitchPosition/DropdownWidget position's own
// onSelect actions pass its index alongside $value (that position's own
// name — see runActionStep in main/index.ts), so an expression shared
// across every position can still tell which one fired it.
export function evaluateMappingExpression(expr: string, rawValue: VariableValue, variables: VariableMap, index?: number): ExpressionResult {
  return tryEvaluateExpression(expr, { ...variables, $value: rawValue, ...(index !== undefined ? { $index: index } : {}) })
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
// A Gauge/Adjuster's valueExpr — same mechanism as every other bindable
// field here, just coercing the result to a finite number. Any failure mode
// (throw, non-number, NaN/Infinity) returns undefined so callers fall back
// to their own default (the widget's own `min`) rather than crashing render.
export function resolveNumericExpr(expr: string, variables: VariableMap): number | undefined {
  const result = tryEvaluateExpression(expr, variables)
  if (!result.ok || typeof result.value !== 'number' || !Number.isFinite(result.value)) return undefined
  return result.value
}

// Same mechanism as resolveNumericExpr, but coerced to a boolean (e.g.
// ToggleSwitchWidget.guardOpenExpr) — any truthy/falsy result works, not
// just a literal `true`/`false`, so `return variables.GEAR_HANDLE;` is valid
// as-is. A thrown/failing expression returns undefined so callers fall back
// to their own default the same way.
export function resolveBooleanExpr(expr: string, variables: VariableMap): boolean | undefined {
  const result = tryEvaluateExpression(expr, variables)
  return result.ok ? Boolean(result.value) : undefined
}

// Same convention as resolveBooleanExpr above — visibleExpr (see
// WidgetVisibility in shared/types.ts) overrides the plain flag when set.
// Shared by every place a widget actually gets drawn: the deployed view
// (ViewCanvas.tsx) hides it outright, the editor's own live preview
// (CanvasWidget.tsx / MorphCanvasWidget.tsx) dims it instead so it stays
// selectable/editable — but both evaluate the exact same expression the
// same way, so a visibleExpr's console.log reaches the debug panel while
// editing, same as any other expression field already does there.
export function resolveWidgetVisible(widget: WidgetVisibility, variables: VariableMap): boolean {
  if (widget.visibleExpr) return resolveBooleanExpr(widget.visibleExpr, variables) ?? true
  return widget.visible ?? true
}

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
// string) once it's set at all (even ''  — freshly switched to expression
// mode, nothing typed yet), else just `text`. Unlike resolveColor/
// resolveBorderColor, an expression in progress or failing does NOT fall
// back to `text` — `text` is stale leftover static content from before
// switching to expression mode, and silently showing it back would read as
// the expression "working" when it isn't.
export function resolveLabelText(label: WidgetLabel, variables: VariableMap): string {
  if (label.textExpr === undefined) return label.text
  const result = tryEvaluateExpression(label.textExpr, variables)
  if (!result.ok) return ''
  return typeof result.value === 'string' ? result.value : String(result.value)
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
