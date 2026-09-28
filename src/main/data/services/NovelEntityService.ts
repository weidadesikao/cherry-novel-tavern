/**
 * Novel Entity Service - entity card and relationship CRUD within a novel,
 * plus SillyTavern character-card import / export.
 *
 * Dual-track rule: ST character cards are imported into the internal
 * `novel_entity` table (camelCased card fields); the source JSON file is never
 * mutated. Export regenerates a standard ST character-card V2 object from the
 * internal card, lossless for loose fields via `card.extra`.
 */

import { application } from '@application'
import { novelTable } from '@data/db/schemas/novel'
import {
  type NovelEntityRelationRow,
  novelEntityRelationTable,
  type NovelEntityRow,
  novelEntityTable
} from '@data/db/schemas/novelEntity'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type {
  CreateNovelEntityDto,
  CreateRelationDto,
  UpdateNovelEntityDto,
  UpdateRelationDto
} from '@shared/data/api/schemas/novels'
import type { NovelEntity, NovelEntityCard, NovelEntityRelation } from '@shared/data/types/novel'
import { exportCharacterCard, parseCharacterCard } from '@shared/stCompat'
import type { StCharacterCardData, StWarning } from '@shared/stCompat/types'
import { and, eq } from 'drizzle-orm'

import { nullsToUndefined, timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:NovelEntityService')

/**
 * Rich narrative card fields <-> namespaced ST `data` keys. Standard ST cards
 * have no such fields, so we round-trip them through `novel_studio_*` keys
 * (lossless) rather than colliding with the spec.
 */
const RICH_FIELD_KEYS: Record<
  'role' | 'status' | 'affiliation' | 'appearance' | 'background' | 'statusChanges',
  string
> = {
  role: 'novel_studio_role',
  status: 'novel_studio_status',
  affiliation: 'novel_studio_affiliation',
  appearance: 'novel_studio_appearance',
  background: 'novel_studio_background',
  statusChanges: 'novel_studio_status_changes'
}
const ALIASES_KEY = 'novel_studio_aliases'

/** ST character-card spec fields handled explicitly; the rest land in `extra`. */
const MODELED_CARD_KEYS = new Set([
  'name',
  'description',
  'personality',
  'scenario',
  'first_mes',
  'mes_example',
  'creator_notes',
  'tags',
  'character_book',
  ALIASES_KEY,
  ...Object.values(RICH_FIELD_KEYS)
])

function rowToEntity(row: NovelEntityRow): NovelEntity {
  return {
    id: row.id,
    novelId: row.novelId,
    type: row.type,
    name: row.name,
    card: row.card,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

function rowToRelation(row: NovelEntityRelationRow): NovelEntityRelation {
  const clean = nullsToUndefined(row)
  return {
    ...clean,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

/** Map an ST character-card `data` block onto the internal camelCased card. */
function stCardToInternal(data: StCharacterCardData): NovelEntityCard {
  const extra: Record<string, string> = {}
  for (const [key, value] of Object.entries(data)) {
    if (!MODELED_CARD_KEYS.has(key) && typeof value === 'string' && value) {
      extra[key] = value
    }
  }

  const card: NovelEntityCard = {}
  if (data.description) card.description = data.description
  if (data.personality) card.personality = data.personality
  if (data.scenario) card.scenario = data.scenario
  if (data.first_mes) card.firstMes = data.first_mes
  if (data.mes_example) card.mesExample = data.mes_example
  if (data.creator_notes) card.creatorNotes = data.creator_notes
  if (data.tags.length > 0) card.tags = data.tags

  // Rich narrative fields restored from their namespaced keys.
  const raw = data as Record<string, unknown>
  for (const [field, key] of Object.entries(RICH_FIELD_KEYS) as Array<[keyof typeof RICH_FIELD_KEYS, string]>) {
    const value = raw[key]
    if (typeof value === 'string' && value) card[field] = value
  }
  const aliasesRaw = raw[ALIASES_KEY]
  if (Array.isArray(aliasesRaw)) {
    const aliases = aliasesRaw.filter((a): a is string => typeof a === 'string' && a.length > 0)
    if (aliases.length > 0) card.aliases = aliases
  }

  if (Object.keys(extra).length > 0) card.extra = extra
  return card
}

/** Build a standard ST character-card V2 object from the internal card. */
function internalToStCard(name: string, card: NovelEntityCard): Record<string, unknown> {
  const data: Record<string, unknown> = {
    name,
    description: card.description ?? '',
    personality: card.personality ?? '',
    scenario: card.scenario ?? '',
    first_mes: card.firstMes ?? '',
    mes_example: card.mesExample ?? '',
    creator_notes: card.creatorNotes ?? '',
    tags: card.tags ?? [],
    ...card.extra
  }
  // Persist rich narrative fields under namespaced keys for a lossless round-trip.
  for (const [field, key] of Object.entries(RICH_FIELD_KEYS) as Array<[keyof typeof RICH_FIELD_KEYS, string]>) {
    const value = card[field]
    if (value) data[key] = value
  }
  if (card.aliases && card.aliases.length > 0) data[ALIASES_KEY] = card.aliases
  return exportCharacterCard({ spec: 'chara_card_v2', spec_version: '2.0', data } as never)
}

export class NovelEntityService {
  private get dbService() {
    return application.get('DbService')
  }

  private get db() {
    return this.dbService.getDb()
  }

  private async assertNovelExists(novelId: string): Promise<void> {
    const [novel] = await this.db
      .select({ id: novelTable.id })
      .from(novelTable)
      .where(eq(novelTable.id, novelId))
      .limit(1)
    if (!novel) {
      throw DataApiErrorFactory.notFound('Novel', novelId)
    }
  }

  private async requireEntity(novelId: string, entityId: string): Promise<NovelEntityRow> {
    const [row] = await this.db
      .select()
      .from(novelEntityTable)
      .where(and(eq(novelEntityTable.id, entityId), eq(novelEntityTable.novelId, novelId)))
      .limit(1)
    if (!row) {
      throw DataApiErrorFactory.notFound('NovelEntity', entityId)
    }
    return row
  }

  // ---------- entities ----------

  async list(novelId: string): Promise<NovelEntity[]> {
    await this.assertNovelExists(novelId)
    const rows = await this.db.select().from(novelEntityTable).where(eq(novelEntityTable.novelId, novelId))
    return rows.map(rowToEntity)
  }

  async getById(novelId: string, entityId: string): Promise<NovelEntity> {
    return rowToEntity(await this.requireEntity(novelId, entityId))
  }

  async create(novelId: string, dto: CreateNovelEntityDto): Promise<NovelEntity> {
    await this.assertNovelExists(novelId)
    const row = await this.dbService.withWriteTx(async (tx) => {
      const [inserted] = await tx
        .insert(novelEntityTable)
        .values({ novelId, type: dto.type, name: dto.name, card: dto.card ?? {} })
        .returning()
      return inserted
    })
    logger.info('Created entity', { novelId, id: row.id, type: row.type })
    return rowToEntity(row)
  }

  async update(novelId: string, entityId: string, dto: UpdateNovelEntityDto): Promise<NovelEntity> {
    const row = await this.dbService.withWriteTx(async (tx) => {
      const updates: Partial<typeof novelEntityTable.$inferInsert> = {}
      if (dto.name !== undefined) updates.name = dto.name
      if (dto.type !== undefined) updates.type = dto.type
      if (dto.card !== undefined) updates.card = dto.card

      const [updated] = await tx
        .update(novelEntityTable)
        .set(updates)
        .where(and(eq(novelEntityTable.id, entityId), eq(novelEntityTable.novelId, novelId)))
        .returning()
      if (!updated) {
        throw DataApiErrorFactory.notFound('NovelEntity', entityId)
      }
      return updated
    })
    logger.info('Updated entity', { novelId, id: entityId, changes: Object.keys(dto) })
    return rowToEntity(row)
  }

  async delete(novelId: string, entityId: string): Promise<void> {
    const result = await this.dbService.withWriteTx((tx) =>
      tx.delete(novelEntityTable).where(and(eq(novelEntityTable.id, entityId), eq(novelEntityTable.novelId, novelId)))
    )
    if (result.rowsAffected === 0) {
      throw DataApiErrorFactory.notFound('NovelEntity', entityId)
    }
    logger.info('Deleted entity', { novelId, id: entityId })
  }

  // ---------- ST character card import / export ----------

  async importStCard(novelId: string, json: unknown): Promise<{ entity: NovelEntity; warnings: StWarning[] }> {
    await this.assertNovelExists(novelId)
    const { data: parsed, warnings } = parseCharacterCard(json)
    const name = parsed.data.name.trim() || '未命名角色'
    const card = stCardToInternal(parsed.data)

    const row = await this.dbService.withWriteTx(async (tx) => {
      const [inserted] = await tx
        .insert(novelEntityTable)
        .values({ novelId, type: 'character', name, card })
        .returning()
      return inserted
    })
    logger.info('Imported ST character card', { novelId, id: row.id, warnings: warnings.length })
    return { entity: rowToEntity(row), warnings }
  }

  async exportStCard(novelId: string, entityId: string): Promise<Record<string, unknown>> {
    const row = await this.requireEntity(novelId, entityId)
    return internalToStCard(row.name, row.card)
  }

  // ---------- relations ----------

  async listRelations(novelId: string): Promise<NovelEntityRelation[]> {
    await this.assertNovelExists(novelId)
    const rows = await this.db
      .select()
      .from(novelEntityRelationTable)
      .where(eq(novelEntityRelationTable.novelId, novelId))
    return rows.map(rowToRelation)
  }

  async createRelation(novelId: string, dto: CreateRelationDto): Promise<NovelEntityRelation> {
    // Both endpoints must belong to this novel; requireEntity enforces scope.
    await this.requireEntity(novelId, dto.fromEntityId)
    await this.requireEntity(novelId, dto.toEntityId)

    const row = await this.dbService.withWriteTx(async (tx) => {
      const [inserted] = await tx
        .insert(novelEntityRelationTable)
        .values({
          novelId,
          fromEntityId: dto.fromEntityId,
          toEntityId: dto.toEntityId,
          relationType: dto.relationType,
          description: dto.description
        })
        .returning()
      return inserted
    })
    logger.info('Created relation', { novelId, id: row.id })
    return rowToRelation(row)
  }

  async updateRelation(novelId: string, relationId: string, dto: UpdateRelationDto): Promise<NovelEntityRelation> {
    const row = await this.dbService.withWriteTx(async (tx) => {
      const updates: Partial<typeof novelEntityRelationTable.$inferInsert> = {}
      if (dto.relationType !== undefined) updates.relationType = dto.relationType
      if (dto.description !== undefined) updates.description = dto.description

      const [updated] = await tx
        .update(novelEntityRelationTable)
        .set(updates)
        .where(and(eq(novelEntityRelationTable.id, relationId), eq(novelEntityRelationTable.novelId, novelId)))
        .returning()
      if (!updated) {
        throw DataApiErrorFactory.notFound('NovelEntityRelation', relationId)
      }
      return updated
    })
    logger.info('Updated relation', { novelId, id: relationId, changes: Object.keys(dto) })
    return rowToRelation(row)
  }

  async deleteRelation(novelId: string, relationId: string): Promise<void> {
    const result = await this.dbService.withWriteTx((tx) =>
      tx
        .delete(novelEntityRelationTable)
        .where(and(eq(novelEntityRelationTable.id, relationId), eq(novelEntityRelationTable.novelId, novelId)))
    )
    if (result.rowsAffected === 0) {
      throw DataApiErrorFactory.notFound('NovelEntityRelation', relationId)
    }
    logger.info('Deleted relation', { novelId, id: relationId })
  }
}

export const novelEntityService = new NovelEntityService()
