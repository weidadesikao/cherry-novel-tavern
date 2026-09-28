import { describe, expect, it } from 'vitest'

import type { ChatMessage, StWorldbookEntry } from '../types'
import { ST_SELECTIVE_LOGIC, ST_WI_POSITION } from '../types'
import { matchWorldInfo } from '../worldInfo'

function entry(partial: Partial<StWorldbookEntry>): StWorldbookEntry {
  return {
    keys: [],
    content: '',
    enabled: true,
    constant: false,
    selective: false,
    insertionOrder: 100,
    ...partial
  }
}

function messages(...contents: string[]): ChatMessage[] {
  return contents.map((content, index) => ({ role: index % 2 === 0 ? 'user' : 'assistant', content }))
}

describe('matchWorldInfo', () => {
  it('triggers on a keyword in recent messages', () => {
    const entries = [entry({ keys: ['赤焰军'], content: '赤焰军设定' })]
    const result = matchWorldInfo(entries, messages('听说赤焰军要进城了'))
    expect(result.before).toHaveLength(1)
  })

  it('does not trigger outside scan depth', () => {
    const entries = [entry({ keys: ['赤焰军'], content: 'x', scanDepth: 1 })]
    const result = matchWorldInfo(entries, messages('赤焰军出现', '后来呢？'))
    expect(result.activated).toHaveLength(0)
  })

  it('always includes constant entries and never disabled ones', () => {
    const entries = [
      entry({ constant: true, content: '常驻', comment: 'c' }),
      entry({ constant: true, enabled: false, content: '禁用', comment: 'd' })
    ]
    const result = matchWorldInfo(entries, [])
    expect(result.activated.map((e) => e.comment)).toEqual(['c'])
  })

  it('is case-insensitive by default, sensitive when set', () => {
    const insensitive = entry({ keys: ['Dragon'], content: 'x' })
    const sensitive = entry({ keys: ['Dragon'], content: 'y', caseSensitive: true })
    const result = matchWorldInfo([insensitive, sensitive], messages('a dragon appears'))
    expect(result.activated).toHaveLength(1)
  })

  it('supports whole-word matching for ASCII keys', () => {
    const wholeWord = entry({ keys: ['cat'], content: 'x', matchWholeWords: true })
    expect(matchWorldInfo([wholeWord], messages('a category mistake')).activated).toHaveLength(0)
    expect(matchWorldInfo([wholeWord], messages('a cat sits')).activated).toHaveLength(1)
  })

  it('supports regex keys in /pattern/flags form', () => {
    const regex = entry({ keys: ['/第[一二三]章/'], content: 'x' })
    expect(matchWorldInfo([regex], messages('翻到第二章')).activated).toHaveLength(1)
    expect(matchWorldInfo([regex], messages('翻到第五章')).activated).toHaveLength(0)
  })

  describe('selective secondary-key logic', () => {
    const base = { keys: ['林家'], selective: true, secondaryKeys: ['军队', '私军'], content: 'x' }

    it('AND_ANY requires any secondary key', () => {
      const e = entry({ ...base, selectiveLogic: ST_SELECTIVE_LOGIC.AND_ANY })
      expect(matchWorldInfo([e], messages('林家的私军')).activated).toHaveLength(1)
      expect(matchWorldInfo([e], messages('林家的宅子')).activated).toHaveLength(0)
    })

    it('NOT_ANY requires no secondary key', () => {
      const e = entry({ ...base, selectiveLogic: ST_SELECTIVE_LOGIC.NOT_ANY })
      expect(matchWorldInfo([e], messages('林家的宅子')).activated).toHaveLength(1)
      expect(matchWorldInfo([e], messages('林家的私军')).activated).toHaveLength(0)
    })

    it('AND_ALL requires every secondary key', () => {
      const e = entry({ ...base, selectiveLogic: ST_SELECTIVE_LOGIC.AND_ALL })
      expect(matchWorldInfo([e], messages('林家的军队也是私军')).activated).toHaveLength(1)
      expect(matchWorldInfo([e], messages('林家的军队')).activated).toHaveLength(0)
    })

    it('NOT_ALL blocks only when all secondary keys present', () => {
      const e = entry({ ...base, selectiveLogic: ST_SELECTIVE_LOGIC.NOT_ALL })
      expect(matchWorldInfo([e], messages('林家的军队')).activated).toHaveLength(1)
      expect(matchWorldInfo([e], messages('林家的军队也是私军')).activated).toHaveLength(0)
    })
  })

  it('rolls probability with the injected rng', () => {
    const e = entry({ keys: ['x'], content: 'x', useProbability: true, probability: 30 })
    expect(matchWorldInfo([e], messages('x'), { random: () => 0.2 }).activated).toHaveLength(1)
    expect(matchWorldInfo([e], messages('x'), { random: () => 0.5 }).activated).toHaveLength(0)
  })

  it('routes positions: before / after / at-depth, sorted by insertionOrder', () => {
    const entries = [
      entry({
        constant: true,
        content: 'b2',
        position: ST_WI_POSITION.BEFORE_CHAR,
        insertionOrder: 200,
        comment: 'b2'
      }),
      entry({
        constant: true,
        content: 'b1',
        position: ST_WI_POSITION.BEFORE_CHAR,
        insertionOrder: 100,
        comment: 'b1'
      }),
      entry({ constant: true, content: 'a', position: ST_WI_POSITION.AFTER_CHAR, comment: 'a' }),
      entry({
        constant: true,
        content: 'd',
        position: ST_WI_POSITION.AT_DEPTH,
        depth: 2,
        role: 'user',
        comment: 'd'
      })
    ]
    const result = matchWorldInfo(entries, [])
    expect(result.before.map((e) => e.comment)).toEqual(['b1', 'b2'])
    expect(result.after.map((e) => e.comment)).toEqual(['a'])
    expect(result.depthInjections).toEqual([
      { depth: 2, role: 'user', content: 'd', order: 100, source: 'worldInfo:d' }
    ])
  })

  it('degrades unsupported positions to after-char', () => {
    const e = entry({ constant: true, content: 'an', position: ST_WI_POSITION.AN_TOP, comment: 'an' })
    const result = matchWorldInfo([e], [])
    expect(result.after.map((x) => x.comment)).toEqual(['an'])
  })
})
