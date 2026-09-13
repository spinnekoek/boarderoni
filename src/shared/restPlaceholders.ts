// Scans a RestWebhookTarget's payloadTemplate for {{name}} tokens —
// the single source of truth for "what placeholders does this template
// have," used both by the main-process executor (runCallRestAction in
// main/index.ts) and the renderer's CallRestActionEditor, so the two never
// drift out of sync. Order-preserving, deduplicated.
export function extractPlaceholders(template: string): string[] {
  const seen = new Set<string>()
  for (const match of template.matchAll(/\{\{(\w+)\}\}/g)) seen.add(match[1])
  return [...seen]
}

// Same as extractPlaceholders, unioned across several template strings at
// once — a RestWebhookTarget's payloadTemplate plus every one of its
// headers' own values can each carry {{name}} tokens, and the action editor
// needs one combined, deduplicated, order-preserving list to render a
// single Values row per distinct placeholder regardless of which template(s)
// it appears in.
export function extractAllPlaceholders(templates: string[]): string[] {
  const seen = new Set<string>()
  for (const template of templates) {
    for (const name of extractPlaceholders(template)) seen.add(name)
  }
  return [...seen]
}
