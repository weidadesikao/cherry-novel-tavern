import { NovelEntityService, novelEntityService } from '@data/services/NovelEntityService'
import { novelService } from '@data/services/NovelService'
import { ErrorCode } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

describe('NovelEntityService', () => {
  setupTestDatabase()

  async function makeNovel() {
    return novelService.create({ title: 'Entities', creationMode: 'free' })
  }

  it('exports a module-level singleton', () => {
    expect(novelEntityService).toBeInstanceOf(NovelEntityService)
  })

  it('creates, lists, updates and deletes an entity', async () => {
    const novel = await makeNovel()
    const entity = await novelEntityService.create(novel.id, {
      type: 'character',
      name: '林夜',
      card: { description: '冷峻的剑客' }
    })

    expect(entity).toMatchObject({ type: 'character', name: '林夜', card: { description: '冷峻的剑客' } })
    expect(await novelEntityService.list(novel.id)).toHaveLength(1)

    const updated = await novelEntityService.update(novel.id, entity.id, { card: { description: '温和的学者' } })
    expect(updated.card.description).toBe('温和的学者')

    await novelEntityService.delete(novel.id, entity.id)
    expect(await novelEntityService.list(novel.id)).toHaveLength(0)
  })

  it('defaults card to an empty object when omitted', async () => {
    const novel = await makeNovel()
    const entity = await novelEntityService.create(novel.id, { type: 'location', name: '北境城' })
    expect(entity.card).toEqual({})
  })

  it('imports an ST V2 character card into a character entity', async () => {
    const novel = await makeNovel()
    const json = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: '苏婉',
        description: '名门之女',
        personality: '外柔内刚',
        first_mes: '你来了。',
        tags: ['女主', '世家'],
        favorite_color: '青'
      }
    }

    const { entity, warnings } = await novelEntityService.importStCard(novel.id, json)
    expect(entity.type).toBe('character')
    expect(entity.name).toBe('苏婉')
    expect(entity.card).toMatchObject({
      description: '名门之女',
      personality: '外柔内刚',
      firstMes: '你来了。',
      tags: ['女主', '世家']
    })
    // Unmodeled string fields are preserved in extra.
    expect(entity.card.extra).toMatchObject({ favorite_color: '青' })
    expect(warnings).toEqual([])
  })

  it('warns when importing a V1 character card', async () => {
    const novel = await makeNovel()
    const { entity, warnings } = await novelEntityService.importStCard(novel.id, {
      name: '旧格式',
      description: 'V1 卡'
    })
    expect(entity.name).toBe('旧格式')
    expect(warnings.some((w) => w.code === 'character_card_v1')).toBe(true)
  })

  it('round-trips import then export to a standard ST V2 object', async () => {
    const novel = await makeNovel()
    const { entity } = await novelEntityService.importStCard(novel.id, {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: { name: '展昭', description: '御猫', mes_example: '<START>' }
    })

    const exported = await novelEntityService.exportStCard(novel.id, entity.id)
    expect(exported).toMatchObject({ spec: 'chara_card_v2', spec_version: '2.0' })
    expect(exported.data).toMatchObject({ name: '展昭', description: '御猫', mes_example: '<START>' })
  })

  it('round-trips rich narrative fields through namespaced ST keys', async () => {
    const novel = await makeNovel()
    const created = await novelEntityService.create(novel.id, {
      type: 'character',
      name: '藤原琴音',
      card: {
        role: '配角',
        status: '活跃在场',
        affiliation: '话剧社',
        appearance: '高一学生，背粉色书包',
        background: '翔太的妹妹，参与秘密组织',
        statusChanges: '从普通学生转为可疑人物',
        aliases: ['琴音']
      }
    })

    const exported = (await novelEntityService.exportStCard(novel.id, created.id)) as {
      data: Record<string, unknown>
    }
    expect(exported.data.novel_studio_role).toBe('配角')
    expect(exported.data.novel_studio_aliases).toEqual(['琴音'])

    // Re-importing the exported card restores the rich fields onto a new entity.
    const { entity: reimported } = await novelEntityService.importStCard(novel.id, exported)
    expect(reimported.card).toMatchObject({
      role: '配角',
      status: '活跃在场',
      affiliation: '话剧社',
      appearance: '高一学生，背粉色书包',
      background: '翔太的妹妹，参与秘密组织',
      statusChanges: '从普通学生转为可疑人物',
      aliases: ['琴音']
    })
  })

  it('creates and lists relations, rejecting cross-novel endpoints', async () => {
    const novel = await makeNovel()
    const a = await novelEntityService.create(novel.id, { type: 'character', name: 'A' })
    const b = await novelEntityService.create(novel.id, { type: 'character', name: 'B' })

    const relation = await novelEntityService.createRelation(novel.id, {
      fromEntityId: a.id,
      toEntityId: b.id,
      relationType: '师徒',
      description: 'A 是 B 的师父'
    })
    expect(relation).toMatchObject({ fromEntityId: a.id, toEntityId: b.id, relationType: '师徒' })
    expect(await novelEntityService.listRelations(novel.id)).toHaveLength(1)

    const otherNovel = await makeNovel()
    await expect(
      novelEntityService.createRelation(otherNovel.id, {
        fromEntityId: a.id,
        toEntityId: b.id,
        relationType: 'x'
      })
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
  })

  it('updates and deletes a relation', async () => {
    const novel = await makeNovel()
    const a = await novelEntityService.create(novel.id, { type: 'character', name: 'A' })
    const b = await novelEntityService.create(novel.id, { type: 'character', name: 'B' })
    const relation = await novelEntityService.createRelation(novel.id, {
      fromEntityId: a.id,
      toEntityId: b.id,
      relationType: '朋友'
    })

    const updated = await novelEntityService.updateRelation(novel.id, relation.id, { relationType: '宿敌' })
    expect(updated.relationType).toBe('宿敌')

    await novelEntityService.deleteRelation(novel.id, relation.id)
    expect(await novelEntityService.listRelations(novel.id)).toHaveLength(0)
  })

  it('cascade-deletes relations when an endpoint entity is deleted', async () => {
    const novel = await makeNovel()
    const a = await novelEntityService.create(novel.id, { type: 'character', name: 'A' })
    const b = await novelEntityService.create(novel.id, { type: 'character', name: 'B' })
    await novelEntityService.createRelation(novel.id, { fromEntityId: a.id, toEntityId: b.id, relationType: 'x' })

    await novelEntityService.delete(novel.id, a.id)
    expect(await novelEntityService.listRelations(novel.id)).toHaveLength(0)
  })
})
