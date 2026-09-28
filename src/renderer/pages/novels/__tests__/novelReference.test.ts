import type { KnowledgeSearchResult } from '@shared/data/types/knowledge'
import type { WebSearchResult } from '@shared/data/types/webSearch'
import { describe, expect, it } from 'vitest'

import { buildReferenceBlock, isReferenceMode, REFERENCE_MODES } from '../novelReference'

const knowledge = (text: string): KnowledgeSearchResult =>
  ({
    pageContent: text,
    score: 1,
    scoreKind: 'relevance',
    rank: 1,
    chunkId: 'c',
    metadata: {}
  }) as KnowledgeSearchResult

const web = (title: string, content: string): WebSearchResult => ({
  title,
  content,
  url: 'https://example.com',
  sourceInput: 'q'
})

describe('isReferenceMode', () => {
  it('accepts known modes and rejects others', () => {
    expect(REFERENCE_MODES.every(isReferenceMode)).toBe(true)
    expect(isReferenceMode('nope')).toBe(false)
  })
})

describe('buildReferenceBlock', () => {
  it('returns empty string when there is nothing to inject', () => {
    expect(buildReferenceBlock('fact', { knowledge: [], web: [] })).toBe('')
    // Blank-only chunks are dropped too.
    expect(buildReferenceBlock('fact', { knowledge: [knowledge('   ')], web: [] })).toBe('')
  })

  it('numbers knowledge excerpts and leads with the mode instruction', () => {
    const block = buildReferenceBlock('fact', { knowledge: [knowledge('设定A'), knowledge('设定B')], web: [] })
    expect(block).toContain('事实依据')
    expect(block).toContain('[1] 设定A')
    expect(block).toContain('[2] 设定B')
  })

  it('uses a different lead-in per mode for the same chunks', () => {
    const chunks = { knowledge: [knowledge('某文段')], web: [] }
    const fact = buildReferenceBlock('fact', chunks)
    const style = buildReferenceBlock('style', chunks)
    const imitate = buildReferenceBlock('imitate', chunks)
    expect(fact).not.toBe(style)
    expect(style).not.toBe(imitate)
    expect(style).toContain('风格')
    expect(imitate).toContain('句式')
    // The chunk text itself is identical across modes — only the framing differs.
    expect(fact).toContain('某文段')
    expect(style).toContain('某文段')
  })

  it('appends a web section after the knowledge section', () => {
    const block = buildReferenceBlock('fact', {
      knowledge: [knowledge('设定A')],
      web: [web('某新闻', '网络内容')]
    })
    expect(block).toContain('[1] 设定A')
    expect(block).toContain('网络搜索')
    expect(block).toContain('[网1] 某新闻')
    expect(block).toContain('网络内容')
    expect(block.indexOf('设定A')).toBeLessThan(block.indexOf('网络内容'))
  })

  it('emits only the web section when no knowledge is selected', () => {
    const block = buildReferenceBlock('style', { knowledge: [], web: [web('标题', '正文')] })
    expect(block).not.toContain('风格')
    expect(block).toContain('网络搜索')
    expect(block).toContain('[网1] 标题')
  })
})
