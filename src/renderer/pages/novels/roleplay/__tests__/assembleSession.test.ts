import type { NovelEntity, WorldbookEntry } from '@shared/data/types/novel'
import { describe, expect, it } from 'vitest'

import { assembleSession, entitiesToCardJson, entityToCardJson } from '../assembleSession'

describe('entityToCardJson', () => {
  it('maps a camelCase entity card onto a standard ST V2 data block', () => {
    const entity: NovelEntity = {
      id: '00000000-0000-4000-8000-0000000000aa',
      novelId: '00000000-0000-4000-8000-0000000000bb',
      type: 'character',
      name: '凛',
      card: { description: '冷峻剑客', firstMes: '你来了。', tags: ['主角'], extra: { 外号: '雪刃' } },
      createdAt: '2026-06-18T00:00:00.000Z',
      updatedAt: '2026-06-18T00:00:00.000Z'
    }

    const json = entityToCardJson(entity) as { spec: string; data: Record<string, unknown> }
    expect(json.spec).toBe('chara_card_v2')
    expect(json.data).toMatchObject({
      name: '凛',
      description: '冷峻剑客',
      first_mes: '你来了。',
      tags: ['主角'],
      外号: '雪刃'
    })
  })

  it('entitiesToCardJson: empty → undefined, single → entityToCardJson shape', () => {
    expect(entitiesToCardJson([])).toBeUndefined()

    const entity: NovelEntity = {
      id: '00000000-0000-4000-8000-0000000000e1',
      novelId: '00000000-0000-4000-8000-0000000000e2',
      type: 'character',
      name: '凛',
      card: { description: '冷峻剑客', extra: { 外号: '雪刃' } },
      createdAt: '2026-06-18T00:00:00.000Z',
      updatedAt: '2026-06-18T00:00:00.000Z'
    }
    expect(entitiesToCardJson([entity])).toEqual(entityToCardJson(entity))
  })

  it('entitiesToCardJson: multiple cards merge into labeled sections', () => {
    const base = {
      novelId: '00000000-0000-4000-8000-0000000000f0',
      type: 'character' as const,
      createdAt: '2026-06-18T00:00:00.000Z',
      updatedAt: '2026-06-18T00:00:00.000Z'
    }
    const a: NovelEntity = {
      ...base,
      id: '00000000-0000-4000-8000-0000000000f1',
      name: '凛',
      card: { description: '冷峻剑客', personality: '寡言' }
    }
    const b: NovelEntity = {
      ...base,
      id: '00000000-0000-4000-8000-0000000000f2',
      name: '苏婉',
      card: { description: '名门之女' } // no personality — omitted from that section
    }

    const merged = entitiesToCardJson([a, b]) as { data: Record<string, unknown> }
    expect(merged.data.name).toBe('凛、苏婉')
    expect(merged.data.description).toBe('【凛】\n冷峻剑客\n\n【苏婉】\n名门之女')
    expect(merged.data.personality).toBe('【凛】\n寡言')

    // The merged card flows through assembly like any single card.
    const result = assembleSession({ cardJson: merged, history: [{ role: 'user', content: 'hi' }] })
    const desc = result.messages.find((m) => m.source === 'card:description')
    expect(desc?.content).toContain('【苏婉】')
  })

  it('round-trips through assembleSession into the card:description slot', () => {
    const entity: NovelEntity = {
      id: '00000000-0000-4000-8000-0000000000cc',
      novelId: '00000000-0000-4000-8000-0000000000dd',
      type: 'character',
      name: '苏婉',
      card: { description: '{{char}} 是名门之女。' },
      createdAt: '2026-06-18T00:00:00.000Z',
      updatedAt: '2026-06-18T00:00:00.000Z'
    }

    const result = assembleSession({ cardJson: entityToCardJson(entity), history: [{ role: 'user', content: 'hi' }] })
    const desc = result.messages.find((m) => m.source === 'card:description')
    expect(desc?.content).toBe('苏婉 是名门之女。')
  })
})

describe('assembleSession', () => {
  it('uses the built-in default preset and emits the card description + history', () => {
    const result = assembleSession({
      cardJson: {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: { name: '林夜', description: '{{char}} 是一名冷峻的剑客。' }
      },
      history: [{ role: 'user', content: '你好' }]
    })

    const bySource = result.messages.map((m) => m.source)
    expect(bySource).toContain('card:description')
    // Macro substituted with the card name.
    const desc = result.messages.find((m) => m.source === 'card:description')
    expect(desc?.content).toBe('林夜 是一名冷峻的剑客。')
    // History is present.
    expect(result.messages.some((m) => m.source === 'chatHistory' && m.content === '你好')).toBe(true)
  })

  it('activates a constant worldbook entry into the assembled prompt', () => {
    const entry: WorldbookEntry = {
      id: '00000000-0000-4000-8000-000000000001',
      worldbookId: '00000000-0000-4000-8000-000000000002',
      keys: [],
      content: '这个世界没有魔法，只有蒸汽科技。',
      enabled: true,
      constant: true,
      selective: false,
      insertionOrder: 100,
      createdAt: '2026-06-17T00:00:00.000Z',
      updatedAt: '2026-06-17T00:00:00.000Z'
    }

    const result = assembleSession({
      worldbookEntries: [entry],
      history: [{ role: 'user', content: '开始冒险' }]
    })

    expect(result.messages.some((m) => m.content.includes('蒸汽科技'))).toBe(true)
  })

  it('drops disabled worldbook entries before assembly', () => {
    const entry: WorldbookEntry = {
      id: '00000000-0000-4000-8000-000000000003',
      worldbookId: '00000000-0000-4000-8000-000000000002',
      keys: [],
      content: '禁用条目内容',
      enabled: false,
      constant: true,
      selective: false,
      insertionOrder: 100,
      createdAt: '2026-06-17T00:00:00.000Z',
      updatedAt: '2026-06-17T00:00:00.000Z'
    }

    const result = assembleSession({ worldbookEntries: [entry], history: [{ role: 'user', content: 'hi' }] })
    expect(result.messages.some((m) => m.content.includes('禁用条目内容'))).toBe(false)
  })
})
