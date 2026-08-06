import { describe, expect, it } from 'vitest'
import { parseAircraftCommands, parseAircraftDoc } from './docParser'

// A small hand-written fixture matching DCS-BIOS's confirmed JSON schema
// ({ [category]: { [identifier]: BiosControl } }, snake_case fields) —
// covers a plain integer output, a string output, a multi-output control
// (suffix-disambiguated keys), and a couple of malformed entries that
// should be skipped rather than crash the parse. No `positions` case: a
// real docs folder (~50 aircraft files) was checked and that field is
// never actually populated by DCS-BIOS in practice — see
// shared/dcsBiosTypes.ts's DcsBiosFieldCatalogEntry, which dropped it.
const FIXTURE = {
  UFC: {
    UFC_COMM1_CHANNEL_SELECT: {
      category: 'UFC',
      control_type: 'selector',
      identifier: 'UFC_COMM1_CHANNEL_SELECT',
      description: 'COMM1 Channel Select Knob',
      inputs: [],
      outputs: [{ address: 0x1000, mask: 0xff00, max_value: 3, shift_by: 8, suffix: '', type: 'integer' }]
    },
    UFC_SCRATCHPAD_STRING_1_DISPLAY: {
      category: 'UFC',
      control_type: 'display',
      identifier: 'UFC_SCRATCHPAD_STRING_1_DISPLAY',
      description: 'Scratchpad String 1 Display',
      inputs: [],
      outputs: [{ address: 0x1002, max_length: 2, suffix: '', type: 'string' }]
    },
    BROKEN_NO_OUTPUTS: {
      category: 'UFC',
      identifier: 'BROKEN_NO_OUTPUTS',
      description: 'Missing outputs entirely'
    },
    BROKEN_BAD_OUTPUT_TYPE: {
      category: 'UFC',
      identifier: 'BROKEN_BAD_OUTPUT_TYPE',
      description: 'Unrecognized output type',
      outputs: [{ address: 0x1004, type: 'float' }]
    }
  },
  WARN: {
    MASTER_CAUTION_LT: {
      category: 'WARN',
      control_type: 'led',
      identifier: 'MASTER_CAUTION_LT',
      description: 'Master Caution Light',
      inputs: [],
      outputs: [
        { address: 0x1020, mask: 0x0001, max_value: 1, shift_by: 0, suffix: '', type: 'integer' },
        { address: 0x1022, max_length: 4, suffix: 'TEXT', type: 'string' }
      ]
    },
    NOT_AN_OBJECT: 'this should be skipped, not crash the parse'
  },
  NOT_A_CATEGORY_OBJECT: 'also skipped'
}

describe('parseAircraftDoc', () => {
  const entries = parseAircraftDoc(FIXTURE)

  it('flattens a plain integer output', () => {
    const rpm = entries.find((e) => e.key === 'MASTER_CAUTION_LT')
    expect(rpm).toEqual({
      key: 'MASTER_CAUTION_LT',
      label: 'Master Caution Light',
      category: 'WARN',
      valueType: 'integer',
      address: 0x1020,
      mask: 0x0001,
      shiftBy: 0,
      maxValue: 1
    })
  })

  it('flattens an integer output with mask/shiftBy/maxValue', () => {
    const channelSelect = entries.find((e) => e.key === 'UFC_COMM1_CHANNEL_SELECT')
    expect(channelSelect).toEqual({
      key: 'UFC_COMM1_CHANNEL_SELECT',
      label: 'COMM1 Channel Select Knob',
      category: 'UFC',
      valueType: 'integer',
      address: 0x1000,
      mask: 0xff00,
      shiftBy: 8,
      maxValue: 3
    })
  })

  it('flattens a string output with maxLength', () => {
    const display = entries.find((e) => e.key === 'UFC_SCRATCHPAD_STRING_1_DISPLAY')
    expect(display).toEqual({
      key: 'UFC_SCRATCHPAD_STRING_1_DISPLAY',
      label: 'Scratchpad String 1 Display',
      category: 'UFC',
      valueType: 'string',
      address: 0x1002,
      maxLength: 2
    })
  })

  it('disambiguates a multi-output control with "<identifier>.<suffix>" keys', () => {
    const textOutput = entries.find((e) => e.key === 'MASTER_CAUTION_LT.TEXT')
    expect(textOutput).toBeDefined()
    expect(textOutput?.valueType).toBe('string')
    expect(textOutput?.maxLength).toBe(4)
  })

  it('skips controls with missing or unrecognized outputs instead of throwing', () => {
    expect(entries.find((e) => e.key === 'BROKEN_NO_OUTPUTS')).toBeUndefined()
    expect(entries.find((e) => e.key === 'BROKEN_BAD_OUTPUT_TYPE')).toBeUndefined()
  })

  it('skips non-object category/control entries instead of throwing', () => {
    // NOT_A_CATEGORY_OBJECT and NOT_AN_OBJECT are strings, not records — the
    // fact that parseAircraftDoc(FIXTURE) above didn't throw already proves
    // this, this just pins the expected total count too.
    expect(entries).toHaveLength(4)
  })

  it('returns an empty list for non-object input', () => {
    expect(parseAircraftDoc(null)).toEqual([])
    expect(parseAircraftDoc('garbage')).toEqual([])
    expect(parseAircraftDoc([1, 2, 3])).toEqual([])
  })
})

// Fixture mirrors the REAL shape confirmed against an actual DCS-BIOS
// install's FA-18C_hornet.json (APU_CONTROL_SW's inputs, verbatim) plus a
// real variable_step example (AMPCD_BRT_CTL) — not guessed.
const COMMAND_FIXTURE = {
  'Auxiliary Power Unit Panel': {
    APU_CONTROL_SW: {
      category: 'Auxiliary Power Unit Panel',
      control_type: 'action',
      description: 'APU Control Switch, ON/OFF',
      identifier: 'APU_CONTROL_SW',
      inputs: [
        { description: 'switch to previous or next state', interface: 'fixed_step' },
        { description: 'set the switch position -- 0 = off, 1 = on', interface: 'set_state', max_value: 1 },
        { argument: 'TOGGLE', description: 'toggle switch state', interface: 'action' }
      ],
      outputs: []
    },
    BROKEN_UNKNOWN_INTERFACE: {
      category: 'Auxiliary Power Unit Panel',
      identifier: 'BROKEN_UNKNOWN_INTERFACE',
      description: 'Has an interface DCS-BIOS does not document',
      inputs: [{ interface: 'set_string', description: 'not a real interface' }],
      outputs: []
    }
  },
  AMPCD: {
    AMPCD_BRT_CTL: {
      category: 'AMPCD',
      control_type: 'analog_dial',
      description: 'Brightness Control',
      identifier: 'AMPCD_BRT_CTL',
      inputs: [
        { description: 'set the position of the dial', interface: 'set_state', max_value: 65535 },
        { description: 'turn the dial left or right', interface: 'variable_step', max_value: 65535, suggested_step: 3200 }
      ],
      outputs: []
    }
  }
}

describe('parseAircraftCommands', () => {
  const commands = parseAircraftCommands(COMMAND_FIXTURE)

  it('flattens a fixed_step input with no extra fields', () => {
    const fixedStep = commands.find((c) => c.identifier === 'APU_CONTROL_SW' && c.interface === 'fixed_step')
    expect(fixedStep).toEqual({
      identifier: 'APU_CONTROL_SW',
      label: 'APU Control Switch, ON/OFF',
      category: 'Auxiliary Power Unit Panel',
      interface: 'fixed_step'
    })
  })

  it('flattens a set_state input with maxValue', () => {
    const setState = commands.find((c) => c.identifier === 'APU_CONTROL_SW' && c.interface === 'set_state')
    expect(setState).toMatchObject({ interface: 'set_state', maxValue: 1 })
  })

  it('flattens an action input with its fixed argument', () => {
    const action = commands.find((c) => c.identifier === 'APU_CONTROL_SW' && c.interface === 'action')
    expect(action).toMatchObject({ interface: 'action', argument: 'TOGGLE' })
  })

  it('flattens a variable_step input with maxValue and suggestedStep', () => {
    const variableStep = commands.find((c) => c.identifier === 'AMPCD_BRT_CTL' && c.interface === 'variable_step')
    expect(variableStep).toMatchObject({ interface: 'variable_step', maxValue: 65535, suggestedStep: 3200 })
  })

  it('produces one entry per interface a control exposes', () => {
    expect(commands.filter((c) => c.identifier === 'APU_CONTROL_SW')).toHaveLength(3)
  })

  it('skips an input with an undocumented interface instead of throwing', () => {
    expect(commands.some((c) => c.identifier === 'BROKEN_UNKNOWN_INTERFACE')).toBe(false)
  })
})
