// Scans a RestDataSource's outgoing.payloadTemplate for {{name}} tokens —
// the single source of truth for "what placeholders does this template
// have," used both by the main-process executor (runCallRestAction in
// main/index.ts) and the renderer's CallRestActionEditor, so the two never
// drift out of sync. Order-preserving, deduplicated.
export function extractPlaceholders(template: string): string[] {
  const seen = new Set<string>()
  for (const match of template.matchAll(/\{\{(\w+)\}\}/g)) seen.add(match[1])
  return [...seen]
}
