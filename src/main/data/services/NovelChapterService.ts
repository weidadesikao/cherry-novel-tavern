/**
 * Novel Chapter Service - chapter CRUD and ordering within a novel
 *
 * Invariants:
 * - Ordering: per-novel fractional-indexing `orderKey`; all reorder paths go
 *   through `applyMoves`.
 * - `wordCount` counts non-whitespace characters (CJK-friendly) and is
 *   recomputed by this service on every content write.
 */

import { application } from '@application'
import { type NovelChapterRow, novelChapterTable, novelTable } from '@data/db/schemas/novel'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { CreateChapterDto, UpdateChapterDto } from '@shared/data/api/schemas/novels'
import type { Chapter, ChapterMeta } from '@shared/data/types/novel'
import { and, asc, eq } from 'drizzle-orm'

import { applyMoves, insertWithOrderKey } from './utils/orderKey'
import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:NovelChapterService')

export function countWords(content: string): number {
  return content.replace(/\s/g, '').length
}

function rowToMeta(row: NovelChapterRow): ChapterMeta {
  return {
    id: row.id,
    novelId: row.novelId,
    title: row.title,
    status: row.status,
    wordCount: row.wordCount,
    orderKey: row.orderKey,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

function rowToChapter(row: NovelChapterRow): Chapter {
  return {
    ...rowToMeta(row),
    content: row.content,
    outline: row.outline ?? undefined
  }
}

export class NovelChapterService {
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

  async list(novelId: string): Promise<ChapterMeta[]> {
    await this.assertNovelExists(novelId)
    const rows = await this.db
      .select()
      .from(novelChapterTable)
      .where(eq(novelChapterTable.novelId, novelId))
      .orderBy(asc(novelChapterTable.orderKey))
    return rows.map(rowToMeta)
  }

  async create(novelId: string, dto: CreateChapterDto): Promise<Chapter> {
    await this.assertNovelExists(novelId)

    const row = await this.dbService.withWriteTx(async (tx) => {
      const inserted = await insertWithOrderKey(
        tx,
        novelChapterTable,
        {
          novelId,
          title: dto.title,
          content: dto.content ?? '',
          outline: dto.outline,
          wordCount: countWords(dto.content ?? '')
        },
        { pkColumn: novelChapterTable.id, scope: eq(novelChapterTable.novelId, novelId) }
      )
      return inserted as NovelChapterRow
    })

    logger.info('Created chapter', { novelId, id: row.id })
    return rowToChapter(row)
  }

  async getById(novelId: string, chapterId: string): Promise<Chapter> {
    const [row] = await this.db
      .select()
      .from(novelChapterTable)
      .where(and(eq(novelChapterTable.id, chapterId), eq(novelChapterTable.novelId, novelId)))
      .limit(1)
    if (!row) {
      throw DataApiErrorFactory.notFound('Chapter', chapterId)
    }
    return rowToChapter(row)
  }

  async update(novelId: string, chapterId: string, dto: UpdateChapterDto): Promise<Chapter> {
    const row = await this.dbService.withWriteTx(async (tx) => {
      const updates: Partial<typeof novelChapterTable.$inferInsert> = {}
      if (dto.title !== undefined) updates.title = dto.title
      if (dto.content !== undefined) {
        updates.content = dto.content
        updates.wordCount = countWords(dto.content)
      }
      if (dto.outline !== undefined) updates.outline = dto.outline
      if (dto.status !== undefined) updates.status = dto.status

      const [updated] = await tx
        .update(novelChapterTable)
        .set(updates)
        .where(and(eq(novelChapterTable.id, chapterId), eq(novelChapterTable.novelId, novelId)))
        .returning()
      if (!updated) {
        throw DataApiErrorFactory.notFound('Chapter', chapterId)
      }
      return updated
    })

    logger.info('Updated chapter', { novelId, id: chapterId, changes: Object.keys(dto) })
    return rowToChapter(row)
  }

  async delete(novelId: string, chapterId: string): Promise<void> {
    const result = await this.dbService.withWriteTx((tx) =>
      tx
        .delete(novelChapterTable)
        .where(and(eq(novelChapterTable.id, chapterId), eq(novelChapterTable.novelId, novelId)))
    )
    if (result.rowsAffected === 0) {
      throw DataApiErrorFactory.notFound('Chapter', chapterId)
    }
    logger.info('Deleted chapter', { novelId, id: chapterId })
  }

  async reorder(novelId: string, chapterId: string, anchor: OrderRequest): Promise<void> {
    await this.getById(novelId, chapterId)
    await this.dbService.withWriteTx((tx) =>
      applyMoves(tx, novelChapterTable, [{ id: chapterId, anchor }], {
        pkColumn: novelChapterTable.id,
        scope: eq(novelChapterTable.novelId, novelId)
      })
    )
  }
}

export const novelChapterService = new NovelChapterService()
