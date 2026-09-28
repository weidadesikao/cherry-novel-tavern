import { novelChapterService } from '@data/services/NovelChapterService'
import { NovelChatSessionService, novelChatSessionService } from '@data/services/NovelChatSessionService'
import { novelService } from '@data/services/NovelService'
import { topicService } from '@data/services/TopicService'
import { NOVEL_TOPIC_PREFIX } from '@shared/data/types/novel'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

describe('NovelChatSessionService', () => {
  setupTestDatabase()

  async function makeChapter() {
    const novel = await novelService.create({ title: '测试小说', creationMode: 'free' })
    const chapter = await novelChapterService.create(novel.id, { title: '第一章' })
    return { novel, chapter }
  }

  it('exports a module-level singleton', () => {
    expect(novelChatSessionService).toBeInstanceOf(NovelChatSessionService)
  })

  it('creates a novel-prefixed topic row together with the session and a dedicated assistant', async () => {
    const { novel, chapter } = await makeChapter()
    const session = await novelChatSessionService.create(novel.id, chapter.id)

    expect(session.topicId.startsWith(NOVEL_TOPIC_PREFIX)).toBe(true)
    expect(session).toMatchObject({ novelId: novel.id, chapterId: chapter.id })
    // Config defaults come from the zod schema.
    expect(session.config).toMatchObject({ entityIds: [], carryTimeline: false, prevChapterCount: 0 })

    // The REAL topic row exists, carries the combined name, and is bound to
    // the novel's dedicated assistant (unlocks the chat capability toolbar).
    const topic = await topicService.getById(session.topicId)
    expect(topic.name).toBe('测试小说·第一章')
    expect(topic.assistantId).toBe(session.assistantId)
    expect(session.assistantId).toBeTruthy()
  })

  it('shares one dedicated assistant across chapters of the same novel', async () => {
    const { novel, chapter } = await makeChapter()
    const chapter2 = await novelChapterService.create(novel.id, { title: '第二章' })

    const first = await novelChatSessionService.create(novel.id, chapter.id)
    const second = await novelChatSessionService.create(novel.id, chapter2.id)
    expect(second.assistantId).toBe(first.assistantId)
  })

  it('is idempotent per chapter and findable by chapter/topic', async () => {
    const { novel, chapter } = await makeChapter()
    const first = await novelChatSessionService.create(novel.id, chapter.id)
    const second = await novelChatSessionService.create(novel.id, chapter.id)
    expect(second.topicId).toBe(first.topicId)

    const byChapter = await novelChatSessionService.getByChapter(novel.id, chapter.id)
    expect(byChapter?.topicId).toBe(first.topicId)
    const byTopic = await novelChatSessionService.getByTopicId(first.topicId)
    expect(byTopic?.chapterId).toBe(chapter.id)
  })

  it('updates config and re-applies schema defaults on read', async () => {
    const { novel, chapter } = await makeChapter()
    const session = await novelChatSessionService.create(novel.id, chapter.id)

    const updated = await novelChatSessionService.updateConfig(novel.id, session.topicId, {
      ...session.config,
      carryTimeline: true,
      prevChapterCount: 2,
      systemPrompt: '自定义提示词'
    })
    expect(updated.config).toMatchObject({ carryTimeline: true, prevChapterCount: 2, systemPrompt: '自定义提示词' })

    const reread = await novelChatSessionService.getByTopicId(session.topicId)
    expect(reread?.config.carryTimeline).toBe(true)
  })

  it('rejects unknown chapters', async () => {
    const { novel } = await makeChapter()
    await expect(novelChatSessionService.create(novel.id, '00000000-0000-4000-8000-0000000000ff')).rejects.toThrow()
  })
})
