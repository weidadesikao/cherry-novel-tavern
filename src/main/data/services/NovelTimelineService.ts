/**
 * Novel Timeline Service - story-event CRUD and ordering within a novel.
 *
 * The timeline view is simply these rows ordered by `orderKey`; all reorder
 * paths go through `applyMoves` (per-novel fractional indexing), matching
 * NovelChapterService.
 */

import { application } from '@application'
import { novelTable } from '@data/db/schemas/novel'
import { type TimelineEventRow, timelineEventTable } from '@data/db/schemas/novel'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { CreateTimelineEventDto, UpdateTimelineEventDto } from '@shared/data/api/schemas/novels'
import type { TimelineEvent } from '@shared/data/types/novel'
import { and, asc, eq } from 'drizzle-orm'

import { applyMoves, insertWithOrderKey } from './utils/orderKey'
import { nullsToUndefined, timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:NovelTimelineService')

function rowToEvent(row: TimelineEventRow): TimelineEvent {
  const clean = nullsToUndefined(row)
  return {
    ...clean,
    participants: row.participants ?? undefined,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

export class NovelTimelineService {
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

  async list(novelId: string): Promise<TimelineEvent[]> {
    await this.assertNovelExists(novelId)
    const rows = await this.db
      .select()
      .from(timelineEventTable)
      .where(eq(timelineEventTable.novelId, novelId))
      .orderBy(asc(timelineEventTable.orderKey))
    return rows.map(rowToEvent)
  }

  async create(novelId: string, dto: CreateTimelineEventDto): Promise<TimelineEvent> {
    await this.assertNovelExists(novelId)
    const row = await this.dbService.withWriteTx(async (tx) => {
      const inserted = await insertWithOrderKey(
        tx,
        timelineEventTable,
        {
          novelId,
          title: dto.title,
          summary: dto.summary ?? '',
          eventType: dto.eventType ?? 'other',
          storyTime: dto.storyTime,
          location: dto.location,
          participants: dto.participants,
          chapterId: dto.chapterId
        },
        { pkColumn: timelineEventTable.id, scope: eq(timelineEventTable.novelId, novelId) }
      )
      return inserted as TimelineEventRow
    })
    logger.info('Created timeline event', { novelId, id: row.id })
    return rowToEvent(row)
  }

  async update(novelId: string, eventId: string, dto: UpdateTimelineEventDto): Promise<TimelineEvent> {
    const row = await this.dbService.withWriteTx(async (tx) => {
      const updates: Partial<typeof timelineEventTable.$inferInsert> = {}
      if (dto.title !== undefined) updates.title = dto.title
      if (dto.summary !== undefined) updates.summary = dto.summary
      if (dto.eventType !== undefined) updates.eventType = dto.eventType
      if (dto.storyTime !== undefined) updates.storyTime = dto.storyTime
      if (dto.location !== undefined) updates.location = dto.location
      if (dto.participants !== undefined) updates.participants = dto.participants
      if (dto.chapterId !== undefined) updates.chapterId = dto.chapterId

      const [updated] = await tx
        .update(timelineEventTable)
        .set(updates)
        .where(and(eq(timelineEventTable.id, eventId), eq(timelineEventTable.novelId, novelId)))
        .returning()
      if (!updated) {
        throw DataApiErrorFactory.notFound('TimelineEvent', eventId)
      }
      return updated
    })
    logger.info('Updated timeline event', { novelId, id: eventId, changes: Object.keys(dto) })
    return rowToEvent(row)
  }

  async delete(novelId: string, eventId: string): Promise<void> {
    const result = await this.dbService.withWriteTx((tx) =>
      tx
        .delete(timelineEventTable)
        .where(and(eq(timelineEventTable.id, eventId), eq(timelineEventTable.novelId, novelId)))
    )
    if (result.rowsAffected === 0) {
      throw DataApiErrorFactory.notFound('TimelineEvent', eventId)
    }
    logger.info('Deleted timeline event', { novelId, id: eventId })
  }

  async reorder(novelId: string, eventId: string, anchor: OrderRequest): Promise<void> {
    const [row] = await this.db
      .select({ id: timelineEventTable.id })
      .from(timelineEventTable)
      .where(and(eq(timelineEventTable.id, eventId), eq(timelineEventTable.novelId, novelId)))
      .limit(1)
    if (!row) {
      throw DataApiErrorFactory.notFound('TimelineEvent', eventId)
    }
    await this.dbService.withWriteTx((tx) =>
      applyMoves(tx, timelineEventTable, [{ id: eventId, anchor }], {
        pkColumn: timelineEventTable.id,
        scope: eq(timelineEventTable.novelId, novelId)
      })
    )
  }
}

export const novelTimelineService = new NovelTimelineService()
