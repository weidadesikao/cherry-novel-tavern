import { WorldbookService, worldbookService } from '@data/services/WorldbookService'
import { ErrorCode } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

describe('WorldbookService', () => {
  setupTestDatabase()

  it('exports a module-level singleton', () => {
    expect(worldbookService).toBeInstanceOf(WorldbookService)
  })

  it('creates an empty worldbook with zero entry count', async () => {
    const wb = await worldbookService.create({ name: '主世界观' })
    expect(wb).toMatchObject({ name: '主世界观', source: 'created', entryCount: 0 })
    expect(await worldbookService.list()).toHaveLength(1)
  })

  it('updates name and description', async () => {
    const wb = await worldbookService.create({ name: '旧名' })
    const updated = await worldbookService.update(wb.id, { name: '新名', description: '说明' })
    expect(updated).toMatchObject({ name: '新名', description: '说明' })
  })

  it('imports an ST world info file and reports entry count', async () => {
    const json = {
      entries: {
        '0': { uid: 0, key: ['魔法'], content: '魔法体系说明', constant: true, order: 100 },
        '1': { uid: 1, key: ['王国'], keysecondary: ['首都'], content: '王国设定', selective: true, order: 50 }
      }
    }
    const { worldbook, warnings } = await worldbookService.importSt({ name: '导入的世界书', json })
    expect(worldbook).toMatchObject({ name: '导入的世界书', source: 'imported', entryCount: 2 })
    expect(warnings).toEqual([])

    const detail = await worldbookService.getById(worldbook.id)
    expect(detail.entries).toHaveLength(2)
    const magic = detail.entries.find((e) => e.keys.includes('魔法'))
    expect(magic).toMatchObject({ content: '魔法体系说明', constant: true })
  })

  it('replaces an existing worldbook when importing with worldbookId', async () => {
    const { worldbook } = await worldbookService.importSt({
      name: '原世界书',
      json: { entries: { '0': { uid: 0, key: ['旧'], content: '旧条目' } } }
    })

    const { worldbook: replaced } = await worldbookService.importSt({
      name: '改名后',
      json: {
        entries: {
          '0': { uid: 0, key: ['新一'], content: '新条目一' },
          '1': { uid: 1, key: ['新二'], content: '新条目二' }
        }
      },
      worldbookId: worldbook.id
    })

    // Same row identity, new name, entry set fully swapped.
    expect(replaced.id).toBe(worldbook.id)
    expect(replaced).toMatchObject({ name: '改名后', entryCount: 2 })
    const detail = await worldbookService.getById(worldbook.id)
    expect(detail.entries.map((e) => e.content).sort()).toEqual(['新条目一', '新条目二'])
    expect(await worldbookService.list()).toHaveLength(1)
  })

  it('rejects replace-import for a missing worldbookId', async () => {
    await expect(
      worldbookService.importSt({ name: 'x', json: { entries: {} }, worldbookId: crypto.randomUUID() })
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
  })

  it('round-trips import then export to a standard ST world info object', async () => {
    const json = {
      entries: {
        '0': { uid: 0, key: ['剑'], content: '神剑', order: 100, position: 0 }
      }
    }
    const { worldbook } = await worldbookService.importSt({ name: 'rt', json })
    const exported = (await worldbookService.exportSt(worldbook.id)) as { entries: Record<string, any> }

    expect(exported.entries).toBeDefined()
    const keys = Object.keys(exported.entries)
    expect(keys).toHaveLength(1)
    expect(exported.entries[keys[0]]).toMatchObject({ key: ['剑'], content: '神剑' })
  })

  it('preserves unmodeled ST fields verbatim through export (lossless)', async () => {
    const json = {
      entries: {
        '0': { uid: 0, key: ['x'], content: 'c', group: 'mygroup', vectorized: true }
      }
    }
    const { worldbook } = await worldbookService.importSt({ name: 'lossless', json })
    const exported = (await worldbookService.exportSt(worldbook.id)) as { entries: Record<string, any> }
    const entry = exported.entries[Object.keys(exported.entries)[0]]
    expect(entry).toMatchObject({ group: 'mygroup', vectorized: true })
  })

  it('manages entries (create / update / delete) and keeps entry count in sync', async () => {
    const wb = await worldbookService.create({ name: 'entries' })
    const entry = await worldbookService.createEntry(wb.id, { keys: ['火'], content: '火属性' })
    expect(entry).toMatchObject({ content: '火属性', keys: ['火'] })

    let listed = await worldbookService.list()
    expect(listed.find((w) => w.id === wb.id)?.entryCount).toBe(1)

    const updated = await worldbookService.updateEntry(wb.id, entry.id, { content: '火属性·改', constant: true })
    expect(updated).toMatchObject({ content: '火属性·改', constant: true })

    await worldbookService.deleteEntry(wb.id, entry.id)
    listed = await worldbookService.list()
    expect(listed.find((w) => w.id === wb.id)?.entryCount).toBe(0)
  })

  it('cascade-deletes entries with the worldbook', async () => {
    const wb = await worldbookService.create({ name: 'cascade' })
    await worldbookService.createEntry(wb.id, { keys: ['a'], content: 'a' })
    await worldbookService.delete(wb.id)
    await expect(worldbookService.getById(wb.id)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
  })

  it('rejects operations on a missing worldbook / entry', async () => {
    const missing = '00000000-0000-4000-8000-000000000000'
    await expect(worldbookService.getById(missing)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    await expect(worldbookService.exportSt(missing)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })

    const wb = await worldbookService.create({ name: 'x' })
    await expect(worldbookService.deleteEntry(wb.id, missing)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
  })
})
