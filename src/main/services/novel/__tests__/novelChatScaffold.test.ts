import { novelChapterService } from '@data/services/NovelChapterService'
import { novelChatSessionService } from '@data/services/NovelChatSessionService'
import { novelService } from '@data/services/NovelService'
import { stPresetService } from '@data/services/StPresetService'
import { worldbookService } from '@data/services/WorldbookService'
import type { CherryUIMessage } from '@shared/data/types/message'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { buildNovelScaffoldHistory, DEFAULT_NOVEL_SYSTEM_PROMPT } from '../novelChatScaffold'

const PRESET_JSON = {
  prompts: [
    { identifier: 'main', name: 'Main', role: 'system', content: 'PRESET-MAIN', system_prompt: true },
    { identifier: 'chatHistory', name: 'Chat History', marker: true, system_prompt: true }
  ],
  prompt_order: [
    {
      character_id: 100001,
      order: [
        { identifier: 'main', enabled: true },
        { identifier: 'chatHistory', enabled: true }
      ]
    }
  ]
}

const WORLDBOOK_JSON = {
  entries: {
    '0': {
      uid: 0,
      key: ['绝不会命中的关键词'],
      keysecondary: [],
      comment: '设定条目',
      content: 'WB-CONTENT',
      constant: false,
      selective: false,
      order: 100,
      position: 0,
      disable: false
    }
  }
}

function text(message: CherryUIMessage): string {
  return message.parts
    .map((part) => (part.type === 'text' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
}

function makeHistory(): CherryUIMessage[] {
  return [
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: '你好' }] },
    { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: '好的' }] },
    { id: 'u2', role: 'user', parts: [{ type: 'text', text: '继续写' }] }
  ]
}

describe('buildNovelScaffoldHistory', () => {
  setupTestDatabase()

  async function makeSession() {
    const novel = await novelService.create({ title: '书', creationMode: 'free' })
    const chapter = await novelChapterService.create(novel.id, { title: '章', content: '章节正文内容' })
    const session = await novelChatSessionService.create(novel.id, chapter.id)
    return { novel, chapter, session }
  }

  it('passes raw history through for a non-session topic', async () => {
    const history = makeHistory()
    const result = await buildNovelScaffoldHistory('novel-00000000-0000-4000-8000-000000000000', history)
    expect(result.messages).toBe(history)
    expect(result.warnings).toEqual([])
  })

  it('without ST assets: prepends the writing-context system turn', async () => {
    const { session } = await makeSession()
    const history = makeHistory()
    const result = await buildNovelScaffoldHistory(session.topicId, history)

    expect(result.messages).toHaveLength(4)
    expect(result.messages[0].role).toBe('system')
    expect(text(result.messages[0])).toContain(DEFAULT_NOVEL_SYSTEM_PROMPT)
    expect(text(result.messages[0])).toContain('【当前章节正文】')
    expect(result.messages.slice(1)).toEqual(history)
  })

  it('with preset + zero-hit worldbook: scaffolds around the REAL messages', async () => {
    const { novel, session } = await makeSession()
    const { preset } = await stPresetService.import({ name: 'P', json: PRESET_JSON })
    const { worldbook } = await worldbookService.importSt({ name: 'W', json: WORLDBOOK_JSON })
    await novelChatSessionService.updateConfig(novel.id, session.topicId, {
      ...session.config,
      presetId: preset.id,
      worldbookId: worldbook.id
    })

    const history = makeHistory()
    const result = await buildNovelScaffoldHistory(session.topicId, history)

    // Preset scaffold made it in.
    const allText = result.messages.map(text).join('\n---\n')
    expect(allText).toContain('PRESET-MAIN')

    // The real history objects ride through by reference (attachments survive).
    const ids = result.messages.map((message) => message.id)
    expect(ids).toEqual(expect.arrayContaining(['u1', 'a1', 'u2']))
    expect(ids.indexOf('u1')).toBeLessThan(ids.indexOf('a1'))
    expect(ids.indexOf('a1')).toBeLessThan(ids.indexOf('u2'))

    // All system turns (preset scaffold + the spliced writing context) are
    // merged into ONE leading system message — Gemini / some Claude-compatible
    // gateways reject system messages that aren't at the very start.
    expect(result.messages[0].role).toBe('system')
    const mergedSystemText = text(result.messages[0])
    expect(mergedSystemText).toContain('PRESET-MAIN')
    expect(mergedSystemText).toContain('【当前章节正文】')
    expect(mergedSystemText).toContain('【世界书】')
    expect(mergedSystemText).toContain('WB-CONTENT')
    // Only that one leading turn is system — everything else kept its role.
    expect(result.messages.slice(1).every((message) => message.role !== 'system')).toBe(true)

    expect(result.stats.world).toBe(0)
    expect(result.stats.worldTotal).toBe(1)
    expect(result.stats.included).toBeGreaterThan(0)
  })

  it('trims to the configured historyRounds window before assembly', async () => {
    const { novel, session } = await makeSession()
    await novelChatSessionService.updateConfig(novel.id, session.topicId, {
      ...session.config,
      historyRounds: 1
    })

    const history = makeHistory() // [u1, a1, u2] — 1 round = last 2 messages
    const result = await buildNovelScaffoldHistory(session.topicId, history)

    const ids = result.messages.map((message) => message.id)
    expect(ids).not.toContain('u1')
    expect(ids).toContain('a1')
    expect(ids).toContain('u2')
  })

  it('merges scattered system turns into one leading message even without ST assets', async () => {
    const { session } = await makeSession()
    const result = await buildNovelScaffoldHistory(session.topicId, makeHistory())
    const systemCount = result.messages.filter((message) => message.role === 'system').length
    expect(systemCount).toBe(1)
    expect(result.messages[0].role).toBe('system')
  })
})
