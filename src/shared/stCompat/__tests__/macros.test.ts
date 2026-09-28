import { describe, expect, it } from 'vitest'

import { substituteMacros } from '../macros'

describe('substituteMacros', () => {
  const ctx = { char: '林雪', user: '阿明', description: '一位钟表匠' }

  it('replaces known macros', () => {
    const result = substituteMacros('{{char}}对{{user}}说话', ctx)
    expect(result.text).toBe('林雪对阿明说话')
    expect(result.unknownMacros).toEqual([])
  })

  it('is case-insensitive like ST', () => {
    expect(substituteMacros('{{Char}} {{USER}}', ctx).text).toBe('林雪 阿明')
  })

  it('supports the {{bot}} alias for char', () => {
    expect(substituteMacros('{{bot}}', ctx).text).toBe('林雪')
  })

  it('leaves unknown macros untouched and reports them', () => {
    const result = substituteMacros('{{char}} {{roll:d6}} {{lastMessage}}', ctx)
    expect(result.text).toContain('{{lastMessage}}')
    expect(result.unknownMacros).toContain('lastMessage')
    // {{roll:d6}} has a colon so it is not even a macro-shaped token — untouched, unreported
    expect(result.text).toContain('{{roll:d6}}')
  })

  it('supports extension macros via extra', () => {
    const result = substituteMacros('今天是{{weekday}}', { ...ctx, extra: { weekday: '星期五' } })
    expect(result.text).toBe('今天是星期五')
  })

  it('replaces repeated occurrences', () => {
    expect(substituteMacros('{{char}}、{{char}}', ctx).text).toBe('林雪、林雪')
  })
})
