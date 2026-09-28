import { describe, expect, it } from 'vitest'

import { assemblePrompt } from '../assemble'
import { parseCharacterCard } from '../characterCard'
import { parsePreset } from '../preset'
import type { ChatMessage, StWorldbookEntry } from '../types'
import { ST_WI_POSITION } from '../types'

const preset = parsePreset({
  wi_format: '[世界观资料]\n{0}',
  new_chat_prompt: '[开始新的对话]',
  prompts: [
    { identifier: 'main', name: 'Main', role: 'system', content: '你将扮演{{char}}，与{{user}}对话。' },
    { identifier: 'worldInfoBefore', name: 'WI Before', marker: true },
    { identifier: 'charDescription', name: 'Description', marker: true },
    { identifier: 'charPersonality', name: 'Personality', marker: true },
    { identifier: 'scenario', name: 'Scenario', marker: true },
    { identifier: 'worldInfoAfter', name: 'WI After', marker: true },
    { identifier: 'personaDescription', name: 'Persona', marker: true },
    { identifier: 'chatHistory', name: 'Chat History', marker: true },
    {
      identifier: 'styleNudge',
      name: 'Style Nudge',
      role: 'system',
      content: '保持简洁的文风。',
      injection_position: 1,
      injection_depth: 1,
      injection_order: 100
    },
    { identifier: 'disabledOne', name: 'Disabled', role: 'system', content: '不应出现' },
    { identifier: 'emptyOne', name: 'Empty', role: 'system', content: '' }
  ],
  prompt_order: [
    {
      character_id: 100001,
      order: [
        { identifier: 'main', enabled: true },
        { identifier: 'worldInfoBefore', enabled: true },
        { identifier: 'charDescription', enabled: true },
        { identifier: 'charPersonality', enabled: true },
        { identifier: 'scenario', enabled: true },
        { identifier: 'worldInfoAfter', enabled: true },
        { identifier: 'personaDescription', enabled: true },
        { identifier: 'chatHistory', enabled: true },
        { identifier: 'styleNudge', enabled: true },
        { identifier: 'disabledOne', enabled: false },
        { identifier: 'emptyOne', enabled: true }
      ]
    }
  ]
}).data

const card = parseCharacterCard({
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: '林雪',
    description: '{{char}}是一位钟表匠。',
    personality: '沉静',
    scenario: '雪夜的小镇钟楼。'
  }
}).data

const history: ChatMessage[] = [
  { role: 'user', content: '你好，林雪。' },
  { role: 'assistant', content: '……你来了。' },
  { role: 'user', content: '钟楼的钟为什么停了？' }
]

const worldbook: StWorldbookEntry[] = [
  {
    keys: ['钟楼'],
    content: '钟楼建于百年前，{{char}}的祖父是首任守钟人。',
    enabled: true,
    constant: false,
    selective: false,
    insertionOrder: 100,
    position: ST_WI_POSITION.BEFORE_CHAR,
    comment: '钟楼'
  },
  {
    keys: [],
    content: '小镇常年下雪。',
    enabled: true,
    constant: true,
    selective: false,
    insertionOrder: 50,
    position: ST_WI_POSITION.AFTER_CHAR,
    comment: '气候'
  }
]

describe('assemblePrompt', () => {
  const result = assemblePrompt({
    preset,
    card,
    persona: '我是来修钟的旅人。',
    userName: '旅人',
    history,
    worldbookEntries: worldbook
  })

  it('assembles slots and prompts in prompt_order sequence', () => {
    const sources = result.messages.map((m) => m.source)
    expect(sources).toEqual([
      'preset:main',
      'worldInfo:before',
      'card:description',
      'card:personality',
      'card:scenario',
      'worldInfo:after',
      'persona',
      'preset:new_chat_prompt',
      'chatHistory',
      'chatHistory',
      'preset:styleNudge', // depth 1 → before the last history message
      'chatHistory'
    ])
  })

  it('substitutes macros across prompts, card fields and world info', () => {
    expect(result.messages[0].content).toBe('你将扮演林雪，与旅人对话。')
    expect(result.messages[2].content).toBe('林雪是一位钟表匠。')
    expect(result.messages[1].content).toContain('林雪的祖父是首任守钟人')
  })

  it('applies wi_format to world info blocks', () => {
    expect(result.messages[1].content.startsWith('[世界观资料]\n')).toBe(true)
  })

  it('injects depth prompts at the right place in history', () => {
    const styleIndex = result.messages.findIndex((m) => m.source === 'preset:styleNudge')
    expect(result.messages[styleIndex + 1].content).toBe('钟楼的钟为什么停了？')
  })

  it('skips disabled and empty prompts with reasons in the report', () => {
    expect(result.report.skippedPrompts).toContainEqual({ identifier: 'disabledOne', reason: 'disabled' })
    expect(result.report.skippedPrompts).toContainEqual({ identifier: 'emptyOne', reason: 'empty' })
  })

  it('reports activated world info and included prompts', () => {
    expect(result.report.activatedWorldInfo).toEqual(expect.arrayContaining(['钟楼', '气候']))
    expect(result.report.includedPrompts.map((p) => p.identifier)).toContain('main')
  })

  it('warns when chatHistory marker is missing from the order', () => {
    const noHistoryPreset = {
      ...preset,
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }]
    }
    const r = assemblePrompt({ preset: noHistoryPreset, card, history, worldbookEntries: [] })
    expect(r.warnings.some((w) => w.code === 'chat_history_not_emitted')).toBe(true)
  })

  it('falls back to prompts array order when prompt_order is missing', () => {
    const r = assemblePrompt({ preset: { ...preset, prompt_order: [] }, card, history: [] })
    expect(r.warnings.some((w) => w.code === 'missing_prompt_order')).toBe(true)
    expect(r.messages.length).toBeGreaterThan(0)
  })

  it('squashes consecutive system messages when the preset asks for it', () => {
    const squashed = assemblePrompt({
      preset: { ...preset, squash_system_messages: true },
      card,
      persona: '旅人设定',
      userName: '旅人',
      history,
      worldbookEntries: worldbook
    })
    // Everything before the chat history collapses into one system message.
    const beforeHistory = squashed.messages.filter((m) => !m.source.includes('chatHistory'))
    expect(beforeHistory.filter((m) => m.role === 'system').length).toBeLessThan(
      result.messages.filter((m) => m.role === 'system').length
    )
    expect(squashed.messages[0].content).toContain('你将扮演林雪')
    expect(squashed.messages[0].content).toContain('[开始新的对话]')
  })

  it('collects unknown macros into the report', () => {
    const r = assemblePrompt({
      preset: parsePreset({
        prompts: [{ identifier: 'main', role: 'system', content: '{{mysteryMacro}}' }],
        prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }]
      }).data,
      history: []
    })
    expect(r.report.unknownMacros).toContain('mysteryMacro')
  })
})
