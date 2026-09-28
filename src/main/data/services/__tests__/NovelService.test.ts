import { novelChapterTable } from '@data/db/schemas/novel'
import { novelEntityTable } from '@data/db/schemas/novelEntity'
import { NovelService, novelService } from '@data/services/NovelService'
import { ErrorCode } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

describe('NovelService', () => {
  const dbh = setupTestDatabase()

  it('should export a module-level singleton of NovelService', () => {
    expect(novelService).toBeInstanceOf(NovelService)
  })

  it('creates a novel and returns it via getById', async () => {
    const created = await novelService.create({ title: '寒夜回廊', synopsis: '一个设定', creationMode: 'free' })

    expect(created).toMatchObject({
      title: '寒夜回廊',
      synopsis: '一个设定',
      creationMode: 'free'
    })
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/)

    const fetched = await novelService.getById(created.id)
    expect(fetched).toEqual(created)
  })

  it('omits synopsis when not provided', async () => {
    const created = await novelService.create({ title: 'No Synopsis', creationMode: 'imported' })
    expect(created.synopsis).toBeUndefined()
  })

  it('lists all created novels', async () => {
    const first = await novelService.create({ title: 'First', creationMode: 'free' })
    const second = await novelService.create({ title: 'Second', creationMode: 'structured' })

    const novels = await novelService.list()
    const ids = novels.map((novel) => novel.id)

    expect(ids).toContain(first.id)
    expect(ids).toContain(second.id)
  })

  it('updates title and synopsis', async () => {
    const created = await novelService.create({ title: 'Before', synopsis: 'old', creationMode: 'free' })

    const updated = await novelService.update(created.id, { title: 'After', synopsis: null })

    expect(updated.title).toBe('After')
    expect(updated.synopsis).toBeUndefined()
  })

  it('rejects getById / update / delete for a missing novel', async () => {
    const missingId = '00000000-0000-4000-8000-000000000000'

    await expect(novelService.getById(missingId)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    await expect(novelService.update(missingId, { title: 'X' })).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    await expect(novelService.delete(missingId)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
  })

  it('cascade-deletes chapters and entities with their novel', async () => {
    const novel = await novelService.create({ title: 'Cascade', creationMode: 'free' })

    await dbh.db.insert(novelChapterTable).values({
      novelId: novel.id,
      title: '第一章',
      orderKey: 'a0'
    })
    await dbh.db.insert(novelEntityTable).values({
      novelId: novel.id,
      type: 'character',
      name: '主角',
      card: { description: '测试角色' }
    })

    await novelService.delete(novel.id)

    const chapters = await dbh.db.select().from(novelChapterTable).where(eq(novelChapterTable.novelId, novel.id))
    const entities = await dbh.db.select().from(novelEntityTable).where(eq(novelEntityTable.novelId, novel.id))
    expect(chapters).toHaveLength(0)
    expect(entities).toHaveLength(0)
  })
})
