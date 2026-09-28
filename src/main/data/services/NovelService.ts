/**
 * Novel Service - handles novel (bookshelf) CRUD
 *
 * Chapters and entity cards cascade-delete with their novel at the DB level.
 */

import { application } from '@application'
import { type NovelRow, novelTable } from '@data/db/schemas/novel'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CreateNovelDto, UpdateNovelDto } from '@shared/data/api/schemas/novels'
import type { Novel } from '@shared/data/types/novel'
import { desc, eq } from 'drizzle-orm'

import { nullsToUndefined, timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:NovelService')

function rowToNovel(row: NovelRow): Novel {
  const clean = nullsToUndefined(row)
  return {
    ...clean,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

export class NovelService {
  private get dbService() {
    return application.get('DbService')
  }

  private get db() {
    return this.dbService.getDb()
  }

  async list(): Promise<Novel[]> {
    const rows = await this.db.select().from(novelTable).orderBy(desc(novelTable.updatedAt))
    return rows.map(rowToNovel)
  }

  async getById(id: string): Promise<Novel> {
    const [row] = await this.db.select().from(novelTable).where(eq(novelTable.id, id)).limit(1)
    if (!row) {
      throw DataApiErrorFactory.notFound('Novel', id)
    }
    return rowToNovel(row)
  }

  async create(dto: CreateNovelDto): Promise<Novel> {
    const row = await this.dbService.withWriteTx(async (tx) => {
      const [inserted] = await tx
        .insert(novelTable)
        .values({
          title: dto.title,
          synopsis: dto.synopsis,
          creationMode: dto.creationMode
        })
        .returning()
      return inserted
    })

    logger.info('Created novel', { id: row.id })
    return rowToNovel(row)
  }

  async update(id: string, dto: UpdateNovelDto): Promise<Novel> {
    const row = await this.dbService.withWriteTx(async (tx) => {
      const updates: Partial<typeof novelTable.$inferInsert> = {}
      if (dto.title !== undefined) updates.title = dto.title
      if (dto.synopsis !== undefined) updates.synopsis = dto.synopsis

      const [updated] = await tx.update(novelTable).set(updates).where(eq(novelTable.id, id)).returning()
      if (!updated) {
        throw DataApiErrorFactory.notFound('Novel', id)
      }
      return updated
    })

    logger.info('Updated novel', { id, changes: Object.keys(dto) })
    return rowToNovel(row)
  }

  async delete(id: string): Promise<void> {
    const result = await this.dbService.withWriteTx((tx) => tx.delete(novelTable).where(eq(novelTable.id, id)))
    if (result.rowsAffected === 0) {
      throw DataApiErrorFactory.notFound('Novel', id)
    }
    logger.info('Deleted novel', { id })
  }
}

export const novelService = new NovelService()
