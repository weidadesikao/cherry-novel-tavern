import { describe, expect, it } from 'vitest'

import { CreateNovelSchema, UpdateNovelSchema } from '../novels'

describe('novel DTO schemas', () => {
  it('accepts a minimal create payload and trims the title', () => {
    expect(CreateNovelSchema.parse({ title: '  寒夜回廊  ', creationMode: 'free' })).toEqual({
      title: '寒夜回廊',
      creationMode: 'free'
    })
  })

  it('rejects blank titles and unknown creation modes', () => {
    expect(() => CreateNovelSchema.parse({ title: '   ', creationMode: 'free' })).toThrow()
    expect(() => CreateNovelSchema.parse({ title: 'OK', creationMode: 'magic' })).toThrow()
  })

  it('rejects unknown fields on create', () => {
    expect(() => CreateNovelSchema.parse({ title: 'OK', creationMode: 'free', extra: true })).toThrow()
  })

  it('rejects empty update payloads', () => {
    expect(() => UpdateNovelSchema.parse({})).toThrow('At least one field is required')
  })

  it('accepts clearing the synopsis with null', () => {
    expect(UpdateNovelSchema.parse({ synopsis: null })).toEqual({ synopsis: null })
  })
})
