import { describe, expect, it } from 'vitest'

import { exportCharacterCard, parseCharacterCard } from '../characterCard'

const v2Card = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: '高桥海斗',
    description: '县厅职员，{{user}}的同事。',
    personality: '开朗',
    scenario: '北国小县城',
    first_mes: '「早上好。」',
    mes_example: '<START>\n{{char}}: 例子',
    creator_notes: '',
    tags: ['原创'],
    extensions: { depth_prompt: { depth: 4, prompt: '说话带北方口音' } }
  }
}

describe('parseCharacterCard', () => {
  it('parses a v2 card and keeps unknown fields (extensions)', () => {
    const { data, warnings } = parseCharacterCard(v2Card)
    expect(data.data.name).toBe('高桥海斗')
    expect((data.data as Record<string, unknown>).extensions).toEqual(v2Card.data.extensions)
    expect(warnings).toEqual([])
  })

  it('wraps a v1 flat card into v2 structure with a warning', () => {
    const { data, warnings } = parseCharacterCard({ name: '旧角色', description: 'V1 描述' })
    expect(data.data.name).toBe('旧角色')
    expect(data.data.description).toBe('V1 描述')
    expect(warnings.some((w) => w.code === 'character_card_v1')).toBe(true)
  })

  it('warns on unknown spec but still parses', () => {
    const { data, warnings } = parseCharacterCard({ ...v2Card, spec: 'chara_card_v9' })
    expect(data.data.name).toBe('高桥海斗')
    expect(warnings.some((w) => w.code === 'unknown_card_spec')).toBe(true)
  })

  it('warns on missing name', () => {
    const { warnings } = parseCharacterCard({ ...v2Card, data: { ...v2Card.data, name: '  ' } })
    expect(warnings.some((w) => w.code === 'card_missing_name')).toBe(true)
  })

  it('round-trips through export losslessly', () => {
    const { data } = parseCharacterCard(v2Card)
    const exported = exportCharacterCard(data)
    const reparsed = parseCharacterCard(exported)
    expect(reparsed.data.data).toEqual(data.data)
    expect(exported.spec).toBe('chara_card_v2')
  })
})
