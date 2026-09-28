import { StPresetService, stPresetService } from '@data/services/StPresetService'
import { ErrorCode } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

describe('StPresetService', () => {
  setupTestDatabase()

  it('exports a module-level singleton', () => {
    expect(stPresetService).toBeInstanceOf(StPresetService)
  })

  it('imports a preset and stores the JSON verbatim', async () => {
    const json = {
      prompts: [{ identifier: 'main', name: 'Main', content: '你是一个助手' }],
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
      temperature: 0.8,
      custom_vendor_field: 'keep-me'
    }
    const { preset, warnings } = await stPresetService.import({ name: '轻预设', json })
    expect(preset).toMatchObject({ name: '轻预设' })
    expect(warnings).toEqual([])

    const fetched = await stPresetService.getById(preset.id)
    // Stored byte-for-byte, including the unknown vendor field.
    expect(fetched.json).toEqual(json)
  })

  it('surfaces warnings for unsupported preset fields without rejecting', async () => {
    const { warnings } = await stPresetService.import({
      name: '带不支持字段',
      json: { prompts: [], prompt_order: [], wrap_in_quotes: true }
    })
    expect(warnings.some((w) => w.code === 'unsupported_preset_field')).toBe(true)
  })

  it('lists, renames and deletes a preset', async () => {
    const { preset } = await stPresetService.import({ name: 'old', json: { prompts: [], prompt_order: [] } })
    expect((await stPresetService.list()).map((p) => p.id)).toContain(preset.id)

    const renamed = await stPresetService.update(preset.id, { name: 'new' })
    expect(renamed.name).toBe('new')

    await stPresetService.delete(preset.id)
    await expect(stPresetService.getById(preset.id)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
  })

  it('rejects operations on a missing preset', async () => {
    const missing = '00000000-0000-4000-8000-000000000000'
    await expect(stPresetService.getById(missing)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    await expect(stPresetService.update(missing, { name: 'x' })).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    await expect(stPresetService.delete(missing)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
  })

  it('replaces the stored JSON via update (asset JSON dialog save)', async () => {
    const { preset } = await stPresetService.import({ name: 'p', json: { prompts: [], prompt_order: [] } })

    const nextJson = { prompts: [{ identifier: 'main', content: '新内容' }], prompt_order: [], custom_field: 1 }
    await stPresetService.update(preset.id, { json: nextJson })

    // Stored verbatim — including fields the engine does not model.
    const detail = await stPresetService.getById(preset.id)
    expect(detail.json).toEqual(nextJson)
    expect(detail.name).toBe('p')
  })
})
