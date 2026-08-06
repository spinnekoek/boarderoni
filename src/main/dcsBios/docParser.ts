import type { DcsBiosCommandCatalogEntry, DcsBiosFieldCatalogEntry, DcsBiosInputInterface, DcsBiosValueType } from '../../shared/dcsBiosTypes'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

// Shared by parseAircraftDoc/parseAircraftCommands — both walk the exact
// same { [category]: { [identifier]: BiosControl } } shape, just extracting
// a different part of each control (outputs vs. inputs).
function walkControls<T>(
  json: unknown,
  parseControl: (control: unknown, identifierFallback: string, categoryFallback: string) => T[]
): T[] {
  if (!isRecord(json)) return []
  const entries: T[] = []
  for (const [categoryKey, categoryValue] of Object.entries(json)) {
    if (!isRecord(categoryValue)) continue
    for (const [identifierKey, control] of Object.entries(categoryValue)) {
      entries.push(...parseControl(control, identifierKey, categoryKey))
    }
  }
  return entries
}

function parseOutput(output: unknown, identifier: string, label: string, category: string): DcsBiosFieldCatalogEntry | null {
  if (!isRecord(output)) return null
  const address = asNumber(output.address)
  const type = asString(output.type)
  if (address === undefined || (type !== 'integer' && type !== 'string')) return null
  const valueType: DcsBiosValueType = type

  const suffix = asString(output.suffix)
  const key = suffix ? `${identifier}.${suffix}` : identifier

  const entry: DcsBiosFieldCatalogEntry = { key, label, category, valueType, address }

  if (valueType === 'integer') {
    const mask = asNumber(output.mask)
    const shiftBy = asNumber(output.shift_by)
    const maxValue = asNumber(output.max_value)
    if (mask !== undefined) entry.mask = mask
    if (shiftBy !== undefined) entry.shiftBy = shiftBy
    if (maxValue !== undefined) entry.maxValue = maxValue
  } else {
    const maxLength = asNumber(output.max_length)
    if (maxLength !== undefined) entry.maxLength = maxLength
  }

  return entry
}

function parseControlOutputs(control: unknown, identifierFallback: string, categoryFallback: string): DcsBiosFieldCatalogEntry[] {
  if (!isRecord(control)) return []
  const identifier = asString(control.identifier) ?? identifierFallback
  const label = asString(control.description) || identifier
  const category = asString(control.category) ?? categoryFallback
  const outputs = Array.isArray(control.outputs) ? control.outputs : []

  const entries: DcsBiosFieldCatalogEntry[] = []
  for (const output of outputs) {
    const entry = parseOutput(output, identifier, label, category)
    if (entry) entries.push(entry)
  }
  return entries
}

// Flattens one aircraft's DCS-BIOS JSON doc (shape: { [category]: {
// [identifier]: BiosControl } }, snake_case fields — see the plan's
// protocol notes) into a flat list of mappable fields. Malformed
// entries/controls are skipped rather than thrown on — this is
// auto-generated data from an external tool, not user input, but still not
// worth losing a whole aircraft's catalog over one unexpected shape.
export function parseAircraftDoc(json: unknown): DcsBiosFieldCatalogEntry[] {
  return walkControls(json, parseControlOutputs)
}

const INPUT_INTERFACES: DcsBiosInputInterface[] = ['set_state', 'fixed_step', 'action', 'variable_step']

function parseInput(input: unknown, identifier: string, label: string, category: string): DcsBiosCommandCatalogEntry | null {
  if (!isRecord(input)) return null
  const iface = asString(input.interface)
  if (!iface || !INPUT_INTERFACES.includes(iface as DcsBiosInputInterface)) return null

  const entry: DcsBiosCommandCatalogEntry = { identifier, label, category, interface: iface as DcsBiosInputInterface }

  // set_state and variable_step both carry a max_value (the range 0..max
  // for set_state; the max position for variable_step) — confirmed against
  // real aircraft docs, not assumed.
  if (iface === 'set_state' || iface === 'variable_step') {
    const maxValue = asNumber(input.max_value)
    if (maxValue !== undefined) entry.maxValue = maxValue
  }
  if (iface === 'variable_step') {
    const suggestedStep = asNumber(input.suggested_step)
    if (suggestedStep !== undefined) entry.suggestedStep = suggestedStep
  }
  if (iface === 'action') {
    const argument = asString(input.argument)
    if (argument !== undefined) entry.argument = argument
  }

  return entry
}

function parseControlInputs(control: unknown, identifierFallback: string, categoryFallback: string): DcsBiosCommandCatalogEntry[] {
  if (!isRecord(control)) return []
  const identifier = asString(control.identifier) ?? identifierFallback
  const label = asString(control.description) || identifier
  const category = asString(control.category) ?? categoryFallback
  const inputs = Array.isArray(control.inputs) ? control.inputs : []

  const entries: DcsBiosCommandCatalogEntry[] = []
  for (const input of inputs) {
    const entry = parseInput(input, identifier, label, category)
    if (entry) entries.push(entry)
  }
  return entries
}

// Same doc, same walk, but flattening each control's `inputs` (commands you
// can send) instead of its `outputs` (data you can read) — one control
// commonly yields more than one command, one per interface it exposes (e.g.
// a toggle switch typically has both an `action`/TOGGLE and a `set_state`
// explicit-position command).
export function parseAircraftCommands(json: unknown): DcsBiosCommandCatalogEntry[] {
  return walkControls(json, parseControlInputs)
}
