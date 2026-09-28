import { countWords, NovelChapterService, novelChapterService } from '@data/services/NovelChapterService'
import { novelService } from '@data/services/NovelService'
import { ErrorCode } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

describe('countWords', () => {
  it('counts non-whitespace characters (CJK-friendly)', () => {
    expect(countWords('你好 世界')).toBe(4)
    expect(countWords('hello world')).toBe(10)
    expect(countWords('  \n\t ')).toBe(0)
    expect(countWords('')).toBe(0)
  })
})

describe('NovelChapterService', () => {
  setupTestDatabase()

  async function makeNovel() {
    return novelService.create({ title: 'Chapters', creationMode: 'free' })
  }

  it('exports a module-level singleton', () => {
    expect(novelChapterService).toBeInstanceOf(NovelChapterService)
  })

  it('creates a chapter with computed word count and lists meta', async () => {
    const novel = await makeNovel()
    const chapter = await novelChapterService.create(novel.id, { title: '第一章', content: '你好世界' })

    expect(chapter).toMatchObject({ novelId: novel.id, title: '第一章', content: '你好世界', wordCount: 4 })
    expect(chapter.orderKey.length).toBeGreaterThan(0)

    const list = await novelChapterService.list(novel.id)
    expect(list).toHaveLength(1)
    expect(list[0]).not.toHaveProperty('content')
    expect(list[0].id).toBe(chapter.id)
  })

  it('recomputes word count on content update', async () => {
    const novel = await makeNovel()
    const chapter = await novelChapterService.create(novel.id, { title: 'A', content: 'abc' })

    const updated = await novelChapterService.update(novel.id, chapter.id, { content: '一二三四五' })
    expect(updated.wordCount).toBe(5)
  })

  it('orders chapters by orderKey and supports reorder', async () => {
    const novel = await makeNovel()
    const a = await novelChapterService.create(novel.id, { title: 'A' })
    const b = await novelChapterService.create(novel.id, { title: 'B' })
    const c = await novelChapterService.create(novel.id, { title: 'C' })

    let ids = (await novelChapterService.list(novel.id)).map((x) => x.id)
    expect(ids).toEqual([a.id, b.id, c.id])

    await novelChapterService.reorder(novel.id, c.id, { before: a.id })
    ids = (await novelChapterService.list(novel.id)).map((x) => x.id)
    expect(ids).toEqual([c.id, a.id, b.id])
  })

  it('scopes chapters per novel', async () => {
    const n1 = await makeNovel()
    const n2 = await makeNovel()
    await novelChapterService.create(n1.id, { title: 'in n1' })

    expect(await novelChapterService.list(n2.id)).toHaveLength(0)
  })

  it('rejects operations on missing novel / chapter', async () => {
    const missing = '00000000-0000-4000-8000-000000000000'
    await expect(novelChapterService.list(missing)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })

    const novel = await makeNovel()
    await expect(novelChapterService.getById(novel.id, missing)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    await expect(novelChapterService.delete(novel.id, missing)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
  })
})
