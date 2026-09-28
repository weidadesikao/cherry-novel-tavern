import type { TimelineEvent } from '@shared/data/types/novel'
import { describe, expect, it } from 'vitest'

import { formatTimelineBlock } from '../timelineBlock'

const base = {
  novelId: '00000000-0000-4000-8000-0000000000aa',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z'
}

describe('formatTimelineBlock', () => {
  it('returns empty string for no events', () => {
    expect(formatTimelineBlock([])).toBe('')
  })

  it('formats events with type label, time/place, summary, and participants', () => {
    const events = [
      {
        ...base,
        id: '00000000-0000-4000-8000-0000000000e1',
        title: '春游',
        summary: '全班出游',
        eventType: 'daily',
        storyTime: '春游当日',
        location: '林本县',
        participants: ['翔太', '琴音']
      },
      {
        ...base,
        id: '00000000-0000-4000-8000-0000000000e2',
        title: '真相揭露',
        eventType: 'reveal'
      }
    ] as TimelineEvent[]

    const block = formatTimelineBlock(events)
    expect(block.startsWith('【时间轴】\n')).toBe(true)
    expect(block).toContain('1. [日常] 春游（春游当日·林本县）：全班出游（翔太、琴音）')
    expect(block).toContain('2. [揭示] 真相揭露')
  })
})
