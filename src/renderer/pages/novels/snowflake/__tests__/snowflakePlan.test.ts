import { describe, expect, it } from 'vitest'

import {
  buildProposalPrompt,
  buildVolumePlanPrompt,
  composeSynopsis,
  flattenVolumes,
  normalizeProposals,
  normalizeVolumes,
  type NovelProposal
} from '../snowflakePlan'

const PROPOSAL: NovelProposal = {
  title: '时痕',
  logline: '钟表匠每调慢一秒，世界就少一个人。',
  synopsis: '起因段。\n\n发展段。\n\n转折段。\n\n结局段。',
  characters: [{ name: '沈默', role: '主角', description: '想救妹妹的钟表匠' }]
}

describe('buildProposalPrompt', () => {
  it('embeds the proposal count and appends the inspiration', () => {
    const prompt = buildProposalPrompt('一个能控制时间的钟表匠', 3)
    expect(prompt).toContain('构思 3 个可选的小说方案')
    expect(prompt).toContain('恰好生成 3 个方案')
    expect(prompt.endsWith('【创意灵感】\n一个能控制时间的钟表匠')).toBe(true)
  })
})

describe('normalizeProposals', () => {
  it('normalizes proposals and drops titleless entries / nameless characters', () => {
    const result = normalizeProposals({
      proposals: [
        {
          title: '时痕',
          logline: '一句话',
          synopsis: '大纲',
          characters: [{ name: '沈默', role: '主角', description: '钟表匠' }, { role: '无名被过滤' }]
        },
        { logline: '没有书名，被过滤' }
      ]
    })
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('时痕')
    expect(result[0].characters).toEqual([{ name: '沈默', role: '主角', description: '钟表匠' }])
  })

  it('returns empty for garbage input', () => {
    expect(normalizeProposals(null)).toEqual([])
    expect(normalizeProposals('文本')).toEqual([])
    expect(normalizeProposals({ proposals: 'nope' })).toEqual([])
  })
})

describe('buildVolumePlanPrompt', () => {
  it('embeds the chosen proposal fields and characters', () => {
    const prompt = buildVolumePlanPrompt(PROPOSAL)
    expect(prompt).toContain('书名：时痕')
    expect(prompt).toContain('一句话故事：钟表匠每调慢一秒，世界就少一个人。')
    expect(prompt).toContain('- 沈默（主角）：想救妹妹的钟表匠')
  })
})

describe('normalizeVolumes', () => {
  it('keeps only volumes with a title and at least one titled chapter', () => {
    const result = normalizeVolumes({
      volumes: [
        {
          title: '第一卷·雾起',
          summary: '主线',
          chapters: [{ title: '第1章', outline: '要点' }, { outline: '无标题被过滤' }]
        },
        { title: '空卷没有章节', summary: '', chapters: [] },
        { summary: '无卷名', chapters: [{ title: 'x', outline: '' }] }
      ]
    })
    expect(result).toHaveLength(1)
    expect(result[0].chapters).toEqual([{ title: '第1章', outline: '要点' }])
  })

  it('returns empty for garbage input', () => {
    expect(normalizeVolumes(undefined)).toEqual([])
    expect(normalizeVolumes({ volumes: 42 })).toEqual([])
  })
})

describe('flattenVolumes', () => {
  const chapters = [{ title: '第1章', outline: 'a' }]

  it('keeps bare chapter titles for a single volume', () => {
    expect(flattenVolumes([{ title: '正文', summary: '', chapters }])).toEqual(chapters)
  })

  it('prefixes chapter titles with the volume for multi-volume plans', () => {
    const result = flattenVolumes([
      { title: '第一卷', summary: '', chapters },
      { title: '第二卷', summary: '', chapters: [{ title: '第2章', outline: 'b' }] }
    ])
    expect(result.map((c) => c.title)).toEqual(['第一卷·第1章', '第二卷·第2章'])
  })
})

describe('composeSynopsis', () => {
  it('joins logline, synopsis, and the volume plan digest', () => {
    const synopsis = composeSynopsis(PROPOSAL, [
      { title: '第一卷·雾起', summary: '主线铺开。', chapters: [{ title: 'x', outline: '' }] }
    ])
    expect(synopsis.startsWith(PROPOSAL.logline)).toBe(true)
    expect(synopsis).toContain('【分卷规划】\n第一卷·雾起：主线铺开。')
  })

  it('omits the volume section when there are no volumes', () => {
    expect(composeSynopsis(PROPOSAL, [])).not.toContain('【分卷规划】')
  })
})
