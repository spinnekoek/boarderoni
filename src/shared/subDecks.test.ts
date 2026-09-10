import { describe, expect, it } from 'vitest'
import { findSubDeck, findWidgetAnywhere, getSubDeckWidgets, setSubDeckWidgets } from './subDecks'
import type { BarGaugeWidget, Dashboard, SubDeck } from './types'

function widget(id: string): BarGaugeWidget {
  return {
    id,
    type: 'gauge-bar',
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    valueExpr: '',
    min: 0,
    max: 1,
    fill: {},
    track: {},
    labels: []
  }
}

function subDeck(id: string, widgets: BarGaugeWidget[]): SubDeck {
  return { id, name: id, widgets }
}

function dashboard(mainWidgets: BarGaugeWidget[], subDecks: SubDeck[]): Dashboard {
  return {
    id: 'd1',
    name: 'Test',
    backgroundColor: '#000',
    widgets: mainWidgets,
    subDecks
  }
}

describe('findSubDeck', () => {
  it('finds a sub-deck by id', () => {
    const sd = subDeck('sub1', [])
    expect(findSubDeck(dashboard([], [sd]), 'sub1')).toBe(sd)
  })

  it('returns undefined for an unknown id', () => {
    expect(findSubDeck(dashboard([], []), 'missing')).toBeUndefined()
  })
})

describe('getSubDeckWidgets', () => {
  it('returns the main deck widgets when subDeckId is null/undefined', () => {
    const main = [widget('a')]
    expect(getSubDeckWidgets(dashboard(main, []), null)).toBe(main)
    expect(getSubDeckWidgets(dashboard(main, []), undefined)).toBe(main)
  })

  it('returns the named sub-deck widgets', () => {
    const subWidgets = [widget('b')]
    const d = dashboard([widget('a')], [subDeck('sub1', subWidgets)])
    expect(getSubDeckWidgets(d, 'sub1')).toBe(subWidgets)
  })

  it('falls back to main deck widgets when the sub-deck no longer exists', () => {
    const main = [widget('a')]
    expect(getSubDeckWidgets(dashboard(main, []), 'missing')).toBe(main)
  })
})

describe('setSubDeckWidgets', () => {
  it('writes the main deck widgets when subDeckId is null/undefined', () => {
    const d = dashboard([widget('a')], [])
    const next = setSubDeckWidgets(d, null, [widget('z')])
    expect(next.widgets.map((w) => w.id)).toEqual(['z'])
  })

  it('writes the named sub-deck widgets, leaving others untouched', () => {
    const d = dashboard([widget('a')], [subDeck('sub1', [widget('b')]), subDeck('sub2', [widget('c')])])
    const next = setSubDeckWidgets(d, 'sub1', [widget('b2')])
    expect(next.subDecks?.find((sd) => sd.id === 'sub1')?.widgets.map((w) => w.id)).toEqual(['b2'])
    expect(next.subDecks?.find((sd) => sd.id === 'sub2')?.widgets.map((w) => w.id)).toEqual(['c'])
    expect(next.widgets.map((w) => w.id)).toEqual(['a'])
  })

  it('is a no-op when the sub-deck no longer exists', () => {
    const d = dashboard([widget('a')], [])
    expect(setSubDeckWidgets(d, 'missing', [widget('z')])).toBe(d)
  })
})

describe('findWidgetAnywhere', () => {
  it('finds a widget on the main deck', () => {
    const d = dashboard([widget('a')], [])
    expect(findWidgetAnywhere(d, 'a')?.id).toBe('a')
  })

  it('finds a widget on a sub-deck', () => {
    const d = dashboard([widget('a')], [subDeck('sub1', [widget('b')])])
    expect(findWidgetAnywhere(d, 'b')?.id).toBe('b')
  })

  it('returns undefined when the widget exists nowhere', () => {
    const d = dashboard([widget('a')], [subDeck('sub1', [widget('b')])])
    expect(findWidgetAnywhere(d, 'missing')).toBeUndefined()
  })
})
