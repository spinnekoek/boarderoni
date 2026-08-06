// Shared between EventsModal.tsx (adding new mappings) and VariablesModal.tsx
// (adding a manual variable) — anywhere a new variable name gets generated
// needs to avoid silently colliding with one that already exists anywhere
// in the dashboard (another mapping, another source, or a manual variable),
// since applyVariableUpdates in main/index.ts treats same-name as
// "update this existing variable," not "create a separate one."
export function uniqueVariableName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  let i = 2
  while (taken.has(`${base}_${i}`)) i++
  return `${base}_${i}`
}
