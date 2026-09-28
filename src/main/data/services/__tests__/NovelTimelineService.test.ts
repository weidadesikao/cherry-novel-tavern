import { novelService } from '@data/services/NovelService'
import { NovelTimelineService, novelTimelineService } from '@data/services/NovelTimelineService'
import { ErrorCode } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

describe('NovelTimelineService', () => {
  setupTestDatabase()

  async function makeNovel() {
    return novelService.create({ title: 'Timeline', creationMode: 'free' })
  }

  it('exports a module-level singleton', () => {
    expect(novelTimelineService).toBeInstanceOf(NovelTimelineService)
  })

  it('creates an event with defaults and lists it', async () => {
    const novel = await makeNovel()
    const event = await novelTimelineService.create(novel.id, { title: '开篇' })

    expect(event).toMatchObject({ novelId: novel.id, title: '开篇', summary: '', eventType: 'other' })
    expect(event.orderKey.length).toBeGreaterThan(0)

    const list = await novelTimelineService.list(novel.id)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(event.id)
  })

  it('persists the rich event fields', async () => {
    const novel = await makeNovel()
    const event = await novelTimelineService.create(novel.id, {
      title: '春游事件',
      summary: '全班前往西山温泉',
      eventType: 'plot',
      storyTime: '春游当日',
      location: '西山温泉度假区',
      participants: ['翔太', '琴音']
    })
    expect(event).toMatchObject({
      eventType: 'plot',
      storyTime: '春游当日',
      location: '西山温泉度假区',
      participants: ['翔太', '琴音']
    })
  })

  it('orders events by orderKey and supports reorder', async () => {
    const novel = await makeNovel()
    const a = await novelTimelineService.create(novel.id, { title: 'A' })
    const b = await novelTimelineService.create(novel.id, { title: 'B' })
    const c = await novelTimelineService.create(novel.id, { title: 'C' })

    let ids = (await novelTimelineService.list(novel.id)).map((x) => x.id)
    expect(ids).toEqual([a.id, b.id, c.id])

    await novelTimelineService.reorder(novel.id, c.id, { before: a.id })
    ids = (await novelTimelineService.list(novel.id)).map((x) => x.id)
    expect(ids).toEqual([c.id, a.id, b.id])
  })

  it('updates and deletes an event', async () => {
    const novel = await makeNovel()
    const event = await novelTimelineService.create(novel.id, { title: '旧标题' })

    const updated = await novelTimelineService.update(novel.id, event.id, { title: '新标题', eventType: 'turn' })
    expect(updated).toMatchObject({ title: '新标题', eventType: 'turn' })

    await novelTimelineService.delete(novel.id, event.id)
    expect(await novelTimelineService.list(novel.id)).toHaveLength(0)
  })

  it('rejects operations on a missing novel / event', async () => {
    const missing = '00000000-0000-4000-8000-000000000000'
    await expect(novelTimelineService.list(missing)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })

    const novel = await makeNovel()
    await expect(novelTimelineService.delete(novel.id, missing)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    await expect(novelTimelineService.update(novel.id, missing, { title: 'x' })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
  })

  it('cascade-deletes events with their novel', async () => {
    const novel = await makeNovel()
    await novelTimelineService.create(novel.id, { title: '会被级联删除' })
    await novelService.delete(novel.id)
    await expect(novelTimelineService.list(novel.id)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
  })
})
