import { describe, expect, it } from 'vitest'

import { extractSamplingParams, parsePreset } from '../preset'

const minimalPreset = {
  temperature: 0.8,
  top_p: 0.95,
  openai_max_tokens: 4096,
  openai_max_context: 65536,
  prompts: [
    { identifier: 'main', name: 'Main', role: 'system', content: 'You are {{char}}.', system_prompt: true },
    { identifier: 'chatHistory', name: 'Chat History', marker: true },
    {
      identifier: 'styleGuide',
      name: 'Style',
      role: 'system',
      content: 'Keep prose tight.',
      injection_position: 1,
      injection_depth: 2
    }
  ],
  prompt_order: [
    {
      character_id: 100001,
      order: [
        { identifier: 'main', enabled: true },
        { identifier: 'chatHistory', enabled: true },
        { identifier: 'styleGuide', enabled: false }
      ]
    }
  ]
}

describe('parsePreset', () => {
  it('parses a minimal preset and keeps unknown fields', () => {
    const { data, warnings } = parsePreset({ ...minimalPreset, some_future_field: { nested: true } })

    expect(data.prompts).toHaveLength(3)
    expect(data.prompt_order[0].order).toHaveLength(3)
    expect((data as Record<string, unknown>).some_future_field).toEqual({ nested: true })
    expect(warnings).toEqual([])
  })

  it('fills ST defaults for omitted prompt fields', () => {
    const { data } = parsePreset(minimalPreset)
    const main = data.prompts.find((p) => p.identifier === 'main')!
    expect(main.injection_position).toBe(0)
    expect(main.injection_depth).toBe(4)
    expect(main.forbid_overrides).toBe(false)
  })

  it('warns on unsupported behavior flags instead of failing', () => {
    const { warnings } = parsePreset({ ...minimalPreset, wrap_in_quotes: true, function_calling: true })
    const fields = warnings.map((w) => w.message)
    expect(warnings.every((w) => w.code === 'unsupported_preset_field')).toBe(true)
    expect(fields.some((m) => m.includes('wrap_in_quotes'))).toBe(true)
    expect(fields.some((m) => m.includes('function_calling'))).toBe(true)
  })

  it('warns when prompt_order references a missing identifier', () => {
    const broken = {
      ...minimalPreset,
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'ghost', enabled: true }] }]
    }
    const { warnings } = parsePreset(broken)
    expect(warnings.some((w) => w.code === 'unknown_order_identifier')).toBe(true)
  })

  it('extracts sampling params', () => {
    const { data } = parsePreset(minimalPreset)
    expect(extractSamplingParams(data)).toEqual({
      temperature: 0.8,
      topP: 0.95,
      frequencyPenalty: undefined,
      presencePenalty: undefined,
      maxTokens: 4096,
      maxContext: 65536
    })
  })
})
