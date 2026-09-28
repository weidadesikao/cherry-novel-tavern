import type { WorldbookEntry } from '@shared/data/types/novel'
import { describe, expect, it } from 'vitest'

import { formatWorldbookBlock } from '../worldbookBlock'

const base = {
  worldbookId: '00000000-0000-4000-8000-0000000000aa',
  constant: false,
  selective: false,
  insertionOrder: 0,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z'
}

describe('formatWorldbookBlock', () => {
  it('returns empty string when nothing is enabled or contentful', () => {
    expect(formatWorldbookBlock([])).toBe('')
    const entries = [
      { ...base, id: '00000000-0000-4000-8000-0000000000e1', keys: ['邪祟'], content: '禁用条目', enabled: false },
      { ...base, id: '00000000-0000-4000-8000-0000000000e2', keys: ['空白'], content: '   ', enabled: true }
    ] as WorldbookEntry[]
    expect(formatWorldbookBlock(entries)).toBe('')
  })

  it('labels entries by comment, falling back to joined keys', () => {
    const entries = [
      {
        ...base,
        id: '00000000-0000-4000-8000-0000000000e1',
        keys: ['祓邪师'],
        comment: '职业设定',
        content: '祓邪师以符箓驱邪。',
        enabled: true
      },
      {
        ...base,
        id: '00000000-0000-4000-8000-0000000000e2',
        keys: ['邪祟', '妖物'],
        content: '邪祟惧怕晨光。',
        enabled: true
      },
      {
        ...base,
        id: '00000000-0000-4000-8000-0000000000e3',
        keys: ['已禁用'],
        content: '不应出现',
        enabled: false
      }
    ] as WorldbookEntry[]

    const block = formatWorldbookBlock(entries)
    expect(block.startsWith('【世界书】\n')).toBe(true)
    expect(block).toContain('1. 【职业设定】祓邪师以符箓驱邪。')
    expect(block).toContain('2. 【邪祟、妖物】邪祟惧怕晨光。')
    expect(block).not.toContain('不应出现')
  })
})
