import { describe, expect, it } from 'vitest'

import {
  buildProfilePrompt,
  buildScanPrompt,
  buildWholeBookPrompt,
  canonicalizeCharacters,
  type CharacterEvidence,
  type CharacterMention,
  chunkText,
  DEFAULT_WHOLE_BOOK_INSTRUCTIONS,
  extractJsonObject,
  mergeEvents,
  mergeOrganizations,
  mergeRelations,
  mergeWorldbook,
  normalizeChunkMentions,
  normalizeProfile,
  normalizeWholeBook,
  resolveRelations,
  splitChapters
} from '../novelAnalysis'

describe('chunkText', () => {
  it('returns a single chunk when text fits', () => {
    expect(chunkText('短文本', 100)).toEqual(['短文本'])
  })

  it('returns empty array for blank input', () => {
    expect(chunkText('   \n\n  ')).toEqual([])
  })

  it('splits on paragraph boundaries and overlaps the previous tail', () => {
    // size 50 forces one paragraph per chunk; overlap prepends the prior tail.
    const text = ['A'.repeat(40), 'B'.repeat(40), 'C'.repeat(40)].join('\n\n')
    const chunks = chunkText(text, 50, 10)
    expect(chunks).toHaveLength(3)
    // Chunk 1 (the 'B' paragraph) is prefixed with the last 10 chars of chunk 0 (all 'A').
    expect(chunks[1].startsWith('A'.repeat(10))).toBe(true)
    expect(chunks[1].includes('B'.repeat(40))).toBe(true)
  })

  it('hard-splits a single oversized paragraph (no overlap)', () => {
    const chunks = chunkText('X'.repeat(250), 100, 0)
    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toHaveLength(100)
  })
})

describe('extractJsonObject', () => {
  it('parses bare / fenced / embedded JSON and returns null otherwise', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 })
    expect(extractJsonObject('好的：\n```json\n{"a":2}\n```')).toEqual({ a: 2 })
    expect(extractJsonObject('结果 {"a":3} 完')).toEqual({ a: 3 })
    expect(extractJsonObject('没有 JSON')).toBeNull()
  })
})

describe('normalizeChunkMentions', () => {
  it('coerces a chunk and drops nameless / incomplete entries', () => {
    const m = normalizeChunkMentions({
      characters: [
        { name: '藤原翔太', aliases: ['翔太'], fact: '发现了 U 盘' },
        { name: '', aliases: [], fact: '无名' }
      ],
      organizations: [{ name: '话剧社', description: '学校社团' }],
      relations: [
        { fromName: '翔太', toName: '琴音', relationType: '兄妹', description: '' },
        { fromName: '甲', toName: '', relationType: 'x', description: '' }
      ],
      worldbook: [{ keyword: '替换', content: '都市传说' }],
      events: [
        {
          title: '发现U盘',
          summary: '翔太找到藏起的U盘',
          eventType: 'reveal',
          storyTime: '当天',
          location: '家',
          participants: ['翔太']
        },
        { title: '', summary: '无标题应被丢弃', eventType: 'plot', participants: [] }
      ],
      outlineFragment: '开篇',
      styleFragment: '第三人称限知'
    })
    expect(m.characters).toEqual([{ name: '藤原翔太', aliases: ['翔太'], fact: '发现了 U 盘' }])
    expect(m.organizations).toHaveLength(1)
    expect(m.relations).toHaveLength(1)
    expect(m.events).toEqual([
      {
        title: '发现U盘',
        summary: '翔太找到藏起的U盘',
        eventType: 'reveal',
        storyTime: '当天',
        location: '家',
        participants: ['翔太']
      }
    ])
    expect(m.styleFragment).toBe('第三人称限知')
  })

  it('returns empty structure for garbage input', () => {
    const m = normalizeChunkMentions(null)
    expect(m.characters).toEqual([])
    expect(m.outlineFragment).toBe('')
  })
})

describe('splitChapters', () => {
  it('splits on Chinese 第N章 headings and keeps verbatim content', () => {
    const text = ['第一章 开端', '正文一。', '', '第二章 转折', '正文二。', '正文二续。'].join('\n')
    const chapters = splitChapters(text)
    expect(chapters.map((c) => c.title)).toEqual(['第一章 开端', '第二章 转折'])
    expect(chapters[0].content).toBe('正文一。')
    expect(chapters[1].content).toBe('正文二。\n正文二续。')
  })

  it('captures pre-heading text as a 前言 chapter', () => {
    const text = ['楔子内容。', '', '第1章', '正文。', '', '第2章', '更多正文。'].join('\n')
    const chapters = splitChapters(text)
    expect(chapters[0]).toEqual({ title: '前言', content: '楔子内容。' })
    expect(chapters).toHaveLength(3)
  })

  it('does NOT treat a prose sentence starting with 第二天 as a heading', () => {
    const text = '第二天早上，翔太醒来了，发现了一件奇怪的事，这一整段都是正文不是标题。'
    const chapters = splitChapters(text, 10_000)
    expect(chapters).toHaveLength(1)
    expect(chapters[0].title).toBe('第1章')
    expect(chapters[0].content).toBe(text)
  })

  it('falls back to ~size blocks at paragraph boundaries when no headings exist', () => {
    const text = ['A'.repeat(60), 'B'.repeat(60), 'C'.repeat(60)].join('\n\n')
    const chapters = splitChapters(text, 130)
    expect(chapters.length).toBeGreaterThan(1)
    expect(chapters[0].title).toBe('第1章')
    // No text lost across the fallback blocks.
    expect(
      chapters
        .map((c) => c.content)
        .join('\n\n')
        .replace(/\n/g, '')
    ).toBe('A'.repeat(60) + 'B'.repeat(60) + 'C'.repeat(60))
  })

  it('matches English Chapter N headings', () => {
    const text = ['Chapter 1', 'one.', '', 'Chapter 2', 'two.'].join('\n')
    const chapters = splitChapters(text)
    expect(chapters.map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 2'])
  })

  it('splits a single-newline manuscript by line into ~size blocks', () => {
    // Many novels separate paragraphs with one newline, not a blank line —
    // splitting only on \n\n would yield one giant chapter, so we split by line.
    const text = Array.from({ length: 12 }, (_, i) => `第${i + 1}段，` + '字'.repeat(40)).join('\n')
    const chapters = splitChapters(text, 200)
    expect(chapters.length).toBeGreaterThan(2)
    expect(chapters.every((c) => c.content.replace(/\s/g, '').length <= 260)).toBe(true)
  })
})

describe('canonicalizeCharacters', () => {
  it('merges mentions by alias, prefers the longest name, accumulates facts', () => {
    const mentions: CharacterMention[] = [
      { name: '翔太', aliases: [], fact: '吃早餐' },
      { name: '藤原翔太', aliases: ['翔太'], fact: '发现 U 盘' },
      { name: '琴音', aliases: [], fact: '上学' }
    ]
    const evidence = canonicalizeCharacters(mentions)
    expect(evidence).toHaveLength(2)

    const shouta = evidence.find((e) => e.canonicalName === '藤原翔太')
    expect(shouta).toBeDefined()
    expect(shouta!.aliases.has('翔太')).toBe(true)
    expect(shouta!.facts).toEqual(['吃早餐', '发现 U 盘'])

    expect(evidence.find((e) => e.canonicalName === '琴音')?.facts).toEqual(['上学'])
  })

  it('links a later canonical mention to an earlier short-form bucket', () => {
    const evidence = canonicalizeCharacters([
      { name: '凛', aliases: [], fact: 'a' },
      { name: '林夜凛', aliases: ['凛'], fact: 'b' }
    ])
    expect(evidence).toHaveLength(1)
    expect(evidence[0].canonicalName).toBe('林夜凛')
    expect(evidence[0].facts).toEqual(['a', 'b'])
  })
})

describe('merge helpers', () => {
  it('de-dupes organizations / relations / worldbook keeping richer text', () => {
    expect(
      mergeOrganizations([
        { name: '警署', description: '短' },
        { name: '警署', description: '更长的说明' }
      ])
    ).toEqual([{ name: '警署', description: '更长的说明' }])

    expect(
      mergeRelations([
        { fromName: 'A', toName: 'B', relationType: '母子', description: '' },
        { fromName: 'A', toName: 'B', relationType: '母子', description: '相依为命' }
      ])
    ).toHaveLength(1)

    expect(
      mergeWorldbook([
        { keyword: '魔法', content: '短' },
        { keyword: '魔法', content: '更长设定' }
      ])
    ).toEqual([{ keyword: '魔法', content: '更长设定' }])
  })

  it('de-dupes events by title keeping richer summary, preserving order', () => {
    const merged = mergeEvents([
      { title: '春游', summary: '短', eventType: 'plot', storyTime: '', location: '', participants: [] },
      { title: '冲突', summary: '吵架', eventType: 'conflict', storyTime: '', location: '', participants: [] },
      {
        title: '春游',
        summary: '全班去西山温泉，途中发生意外',
        eventType: 'plot',
        storyTime: '',
        location: '',
        participants: []
      }
    ])
    expect(merged.map((e) => e.title)).toEqual(['春游', '冲突'])
    expect(merged[0].summary).toBe('全班去西山温泉，途中发生意外')
  })
})

describe('normalizeProfile', () => {
  const evidence: CharacterEvidence = {
    canonicalName: '苏婉',
    aliases: new Set(['婉儿']),
    facts: ['名门之女', '外柔内刚', '与翔太相识']
  }

  it('maps a model profile and carries name + aliases', () => {
    const profile = normalizeProfile(
      { role: '女主', status: '活跃在场', personality: '外柔内刚', description: '名门之女' },
      evidence
    )
    expect(profile).toMatchObject({ name: '苏婉', aliases: ['婉儿'], role: '女主', personality: '外柔内刚' })
  })

  it('falls back to joined evidence when the model gives no description', () => {
    const profile = normalizeProfile({}, evidence)
    expect(profile.description).toBe('名门之女 外柔内刚 与翔太相识')
  })
})

describe('resolveRelations', () => {
  it('maps name pairs to ids and drops unresolved / self relations', () => {
    const nameToId = new Map([
      ['翔太', 'id-a'],
      ['琴音', 'id-b']
    ])
    expect(
      resolveRelations(
        [
          { fromName: '翔太', toName: '琴音', relationType: '兄妹', description: '和睦' },
          { fromName: '翔太', toName: '陌生人', relationType: '朋友', description: '' },
          { fromName: '翔太', toName: '翔太', relationType: '自己', description: '' }
        ],
        nameToId
      )
    ).toEqual([{ fromEntityId: 'id-a', toEntityId: 'id-b', relationType: '兄妹', description: '和睦' }])
  })
})

describe('prompt templates', () => {
  it('buildScanPrompt substitutes segment tokens and appends the chunk', () => {
    const prompt = buildScanPrompt('正文内容', 0, 3)
    expect(prompt).toContain('第 1/3 段节选')
    expect(prompt.endsWith('【小说节选】\n正文内容')).toBe(true)
  })

  it('buildScanPrompt honors a custom instruction template', () => {
    const prompt = buildScanPrompt('正文', 1, 4, '自定义指令 {{index}}/{{total}}')
    expect(prompt.startsWith('自定义指令 2/4')).toBe(true)
    expect(prompt).toContain('【小说节选】')
  })

  it('buildProfilePrompt substitutes name and aliases', () => {
    const evidence: CharacterEvidence = {
      canonicalName: '藤原翔太',
      aliases: new Set(['翔太']),
      facts: ['发现了 U 盘']
    }
    const prompt = buildProfilePrompt(evidence, '角色 {{name}}，别名 {{aliases}}')
    expect(prompt.startsWith('角色 藤原翔太，别名 翔太')).toBe(true)
    expect(prompt).toContain('1. 发现了 U 盘')
  })

  it('buildWholeBookPrompt appends the manuscript after the instructions', () => {
    const prompt = buildWholeBookPrompt('全书正文')
    expect(prompt.startsWith(DEFAULT_WHOLE_BOOK_INSTRUCTIONS)).toBe(true)
    expect(prompt.endsWith('【小说全文】\n全书正文')).toBe(true)
  })
})

describe('normalizeWholeBook', () => {
  it('normalizes a full whole-book reply including deep character cards', () => {
    const result = normalizeWholeBook({
      characters: [
        {
          name: '藤原翔太',
          aliases: ['翔太'],
          role: '主角',
          status: '活跃在场',
          affiliation: '话剧社',
          description: '高中生侦探。',
          personality: '细心谨慎',
          appearance: '黑发少年',
          background: '幼年随母搬家。',
          statusChanges: '从旁观者变为调查者'
        },
        { name: '', role: '被过滤' }
      ],
      organizations: [{ name: '话剧社', description: '校内社团' }],
      relations: [{ fromName: '藤原翔太', toName: '话剧社', relationType: '隶属', description: '' }],
      worldbook: [{ keyword: '林本县', content: '故事发生地' }],
      events: [
        {
          title: '春游',
          summary: '全班出游',
          eventType: 'daily',
          storyTime: '春游当日',
          location: '林本县',
          participants: ['藤原翔太']
        }
      ],
      outline: '全书大纲。',
      styleProfile: '第三人称有限视角。'
    })
    expect(result).not.toBeNull()
    expect(result!.characters).toHaveLength(1)
    expect(result!.characters[0]).toMatchObject({ name: '藤原翔太', role: '主角', affiliation: '话剧社' })
    expect(result!.organizations).toEqual([{ name: '话剧社', description: '校内社团' }])
    expect(result!.relations).toHaveLength(1)
    expect(result!.worldbook).toHaveLength(1)
    expect(result!.events).toHaveLength(1)
    expect(result!.outline).toBe('全书大纲。')
    expect(result!.styleProfile).toBe('第三人称有限视角。')
  })

  it('coerces junk field types to safe defaults', () => {
    const result = normalizeWholeBook({
      characters: [{ name: '甲', aliases: 'not-an-array', role: 42, personality: null }],
      relations: 'nope',
      outline: ['not', 'a', 'string']
    })
    expect(result!.characters[0]).toMatchObject({ name: '甲', aliases: [], role: '', personality: '' })
    expect(result!.relations).toEqual([])
    expect(result!.outline).toBe('')
  })

  it('de-dupes repeated collections within the single reply', () => {
    const result = normalizeWholeBook({
      characters: [{ name: '甲' }],
      organizations: [
        { name: '话剧社', description: '短' },
        { name: '话剧社', description: '更长的描述' }
      ]
    })
    expect(result!.organizations).toEqual([{ name: '话剧社', description: '更长的描述' }])
  })

  it('returns null for non-objects and for replies with no usable characters', () => {
    expect(normalizeWholeBook(null)).toBeNull()
    expect(normalizeWholeBook('文本')).toBeNull()
    expect(normalizeWholeBook({ characters: [] })).toBeNull()
    expect(normalizeWholeBook({ characters: [{ role: '无名' }] })).toBeNull()
  })
})
