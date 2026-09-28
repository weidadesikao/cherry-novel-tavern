import { describe, expect, it } from 'vitest'

import { exportWorldbook, parseWorldbook } from '../worldbook'

const wiFile = {
  entries: {
    '0': {
      uid: 0,
      key: ['赤焰军'],
      keysecondary: [],
      comment: '赤焰军设定',
      content: '赤焰军是林家的私军。',
      constant: false,
      selective: true,
      selectiveLogic: 0,
      order: 100,
      position: 0,
      disable: false,
      probability: 100,
      useProbability: false,
      // fields the engine does not model — must survive a round trip
      group: '军队',
      sticky: 2,
      automationId: 'aaa'
    },
    '1': {
      uid: 1,
      key: ['林家'],
      content: '林家是梁国第一世家。',
      constant: true,
      order: 50,
      position: 1,
      disable: true
    }
  }
}

describe('parseWorldbook', () => {
  it('maps ST fields onto the normalized entry shape', () => {
    const { data } = parseWorldbook(wiFile)
    expect(data).toHaveLength(2)

    const first = data.find((entry) => entry.uid === 0)!
    expect(first.keys).toEqual(['赤焰军'])
    expect(first.enabled).toBe(true)
    expect(first.insertionOrder).toBe(100)
    expect(first.extra).toMatchObject({ group: '军队', sticky: 2, automationId: 'aaa' })

    const second = data.find((entry) => entry.uid === 1)!
    expect(second.enabled).toBe(false)
    expect(second.constant).toBe(true)
  })

  it('warns when the document has no entries map (preset / card mistaken for a worldbook)', () => {
    // Shaped like an ST preset — parse must not silently yield an empty book.
    const { data, warnings } = parseWorldbook({ temperature: 1, prompts: [], prompt_order: [] })
    expect(data).toEqual([])
    expect(warnings.some((w) => w.code === 'not_a_worldbook')).toBe(true)
    // A real (even empty-entry) worldbook does not trigger it.
    expect(parseWorldbook({ entries: {} }).warnings.some((w) => w.code === 'not_a_worldbook')).toBe(false)
  })

  it('warns on unsupported positions and recursion settings', () => {
    const { warnings } = parseWorldbook({
      entries: {
        '0': { uid: 0, key: ['x'], content: 'x', position: 3 },
        '1': { uid: 1, key: ['y'], content: 'y', preventRecursion: true }
      }
    })
    expect(warnings.some((w) => w.code === 'unsupported_wi_position')).toBe(true)
    expect(warnings.some((w) => w.code === 'recursion_not_supported')).toBe(true)
  })

  it('round-trips losslessly through export', () => {
    const { data } = parseWorldbook(wiFile)
    const exported = exportWorldbook(data) as { entries: Record<string, Record<string, unknown>> }

    expect(exported.entries['0']).toMatchObject({
      key: ['赤焰军'],
      content: '赤焰军是林家的私军。',
      order: 100,
      position: 0,
      disable: false,
      group: '军队',
      sticky: 2
    })
    expect(exported.entries['1']).toMatchObject({ disable: true, constant: true })

    const reparsed = parseWorldbook(exported)
    expect(reparsed.data).toEqual(data)
  })
})
