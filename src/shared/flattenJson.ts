// Walks an arbitrary JSON value into a flat {"a.b.0.c": value} map — this is
// what lets a RestIncomingMapping's `field` be a plain dot/index path (see
// shared/types.ts's own comment on RestIncomingMapping) instead of a real
// JSONPath engine: main/restIncoming.ts flattens each incoming request body
// once per request, then reuses the exact same `field in values` /
// `values[field]` lookup syncPlugins already does for every other
// plugin kind.
export function flattenJson(value: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (Array.isArray(value)) {
    if (value.length === 0) out[prefix] = value
    for (let i = 0; i < value.length; i++) flattenJson(value[i], prefix ? `${prefix}.${i}` : String(i), out)
    return out
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) out[prefix] = value
    for (const [key, child] of entries) flattenJson(child, prefix ? `${prefix}.${key}` : key, out)
    return out
  }
  if (prefix) out[prefix] = value
  return out
}
