/**
 * Worldbook Service - global ST-compatible world-info assets (not novel-scoped).
 *
 * Import parses a standard ST world-info file into the internal tables (lossless
 * via `extra`); the source file is never mutated. Export regenerates a standard
 * ST world-info JSON object from the internal entries.
 */

import { application } from '@application'
import {
  type WorldbookEntryRow,
  worldbookEntryTable,
  type WorldbookRow,
  worldbookTable
} from '@data/db/schemas/worldbook'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type {
  CreateWorldbookDto,
  CreateWorldbookEntryDto,
  ImportWorldbookDto,
  UpdateWorldbookDto,
  UpdateWorldbookEntryDto
} from '@shared/data/api/schemas/worldbooks'
import type { Worldbook, WorldbookEntry } from '@shared/data/types/novel'
import { exportWorldbook, parseWorldbook } from '@shared/stCompat'
import type { StWarning, StWorldbookEntry } from '@shared/stCompat/types'
import { and, count, eq } from 'drizzle-orm'

import { nullsToUndefined, timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:WorldbookService')

function rowToEntry(row: WorldbookEntryRow): WorldbookEntry {
  const clean = nullsToUndefined(row)
  return {
    ...clean,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

/** Internal DB entry → engine StWorldbookEntry, for export. */
function entryRowToStEntry(row: WorldbookEntryRow): StWorldbookEntry {
  return {
    uid: row.uid ?? undefined,
    keys: row.keys,
    secondaryKeys: row.secondaryKeys ?? undefined,
    comment: row.comment ?? undefined,
    content: row.content,
    enabled: row.enabled,
    constant: row.constant,
    selective: row.selective,
    selectiveLogic: row.selectiveLogic ?? undefined,
    position: row.position ?? undefined,
    depth: row.depth ?? undefined,
    insertionOrder: row.insertionOrder,
    probability: row.probability ?? undefined,
    useProbability: row.useProbability ?? undefined,
    scanDepth: row.scanDepth ?? undefined,
    caseSensitive: row.caseSensitive ?? undefined,
    matchWholeWords: row.matchWholeWords ?? undefined,
    role: row.role ?? undefined,
    extra: row.extra ?? undefined
  }
}

/** Engine StWorldbookEntry → row insert values (without identity columns). */
function stEntryToInsert(entry: StWorldbookEntry): Omit<typeof worldbookEntryTable.$inferInsert, 'worldbookId'> {
  return {
    uid: entry.uid,
    keys: entry.keys,
    secondaryKeys: entry.secondaryKeys,
    comment: entry.comment,
    content: entry.content,
    enabled: entry.enabled,
    constant: entry.constant,
    selective: entry.selective,
    selectiveLogic: entry.selectiveLogic,
    position: entry.position,
    depth: entry.depth,
    insertionOrder: entry.insertionOrder,
    probability: entry.probability,
    useProbability: entry.useProbability,
    scanDepth: entry.scanDepth,
    caseSensitive: entry.caseSensitive,
    matchWholeWords: entry.matchWholeWords,
    role: entry.role,
    extra: entry.extra
  }
}

export class WorldbookService {
  private get dbService() {
    return application.get('DbService')
  }

  private get db() {
    return this.dbService.getDb()
  }

  private async entryCount(worldbookId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(worldbookEntryTable)
      .where(eq(worldbookEntryTable.worldbookId, worldbookId))
    return row?.value ?? 0
  }

  private async rowToWorldbook(row: WorldbookRow): Promise<Worldbook> {
    const clean = nullsToUndefined(row)
    return {
      ...clean,
      entryCount: await this.entryCount(row.id),
      createdAt: timestampToISO(row.createdAt),
      updatedAt: timestampToISO(row.updatedAt)
    }
  }

  private async requireWorldbook(worldbookId: string): Promise<WorldbookRow> {
    const [row] = await this.db.select().from(worldbookTable).where(eq(worldbookTable.id, worldbookId)).limit(1)
    if (!row) {
      throw DataApiErrorFactory.notFound('Worldbook', worldbookId)
    }
    return row
  }

  // ---------- worldbooks ----------

  async list(): Promise<Worldbook[]> {
    const rows = await this.db.select().from(worldbookTable)
    return Promise.all(rows.map((row) => this.rowToWorldbook(row)))
  }

  async getById(worldbookId: string): Promise<{ worldbook: Worldbook; entries: WorldbookEntry[] }> {
    const row = await this.requireWorldbook(worldbookId)
    const entryRows = await this.db
      .select()
      .from(worldbookEntryTable)
      .where(eq(worldbookEntryTable.worldbookId, worldbookId))
    return {
      worldbook: await this.rowToWorldbook(row),
      entries: entryRows.map(rowToEntry)
    }
  }

  async create(dto: CreateWorldbookDto): Promise<Worldbook> {
    const row = await this.dbService.withWriteTx(async (tx) => {
      const [inserted] = await tx
        .insert(worldbookTable)
        .values({ name: dto.name, description: dto.description, source: 'created' })
        .returning()
      return inserted
    })
    logger.info('Created worldbook', { id: row.id })
    return this.rowToWorldbook(row)
  }

  async update(worldbookId: string, dto: UpdateWorldbookDto): Promise<Worldbook> {
    const row = await this.dbService.withWriteTx(async (tx) => {
      const updates: Partial<typeof worldbookTable.$inferInsert> = {}
      if (dto.name !== undefined) updates.name = dto.name
      if (dto.description !== undefined) updates.description = dto.description

      const [updated] = await tx
        .update(worldbookTable)
        .set(updates)
        .where(eq(worldbookTable.id, worldbookId))
        .returning()
      if (!updated) {
        throw DataApiErrorFactory.notFound('Worldbook', worldbookId)
      }
      return updated
    })
    logger.info('Updated worldbook', { id: worldbookId, changes: Object.keys(dto) })
    return this.rowToWorldbook(row)
  }

  async delete(worldbookId: string): Promise<void> {
    const result = await this.dbService.withWriteTx((tx) =>
      tx.delete(worldbookTable).where(eq(worldbookTable.id, worldbookId))
    )
    if (result.rowsAffected === 0) {
      throw DataApiErrorFactory.notFound('Worldbook', worldbookId)
    }
    logger.info('Deleted worldbook', { id: worldbookId })
  }

  // ---------- ST world-info import / export ----------

  async importSt(dto: ImportWorldbookDto): Promise<{ worldbook: Worldbook; warnings: StWarning[] }> {
    const { data: entries, warnings } = parseWorldbook(dto.json)

    if (dto.worldbookId) {
      // Replace mode (asset JSON dialog "save"): keep the worldbook row's
      // identity, swap its name and full entry set atomically.
      const worldbookId = dto.worldbookId
      await this.requireWorldbook(worldbookId)
      const row = await this.dbService.withWriteTx(async (tx) => {
        const [updated] = await tx
          .update(worldbookTable)
          .set({ name: dto.name })
          .where(eq(worldbookTable.id, worldbookId))
          .returning()
        await tx.delete(worldbookEntryTable).where(eq(worldbookEntryTable.worldbookId, worldbookId))
        if (entries.length > 0) {
          await tx
            .insert(worldbookEntryTable)
            .values(entries.map((entry) => ({ ...stEntryToInsert(entry), worldbookId })))
        }
        return updated
      })
      logger.info('Replaced worldbook via import', { id: row.id, entries: entries.length, warnings: warnings.length })
      return { worldbook: await this.rowToWorldbook(row), warnings }
    }

    const row = await this.dbService.withWriteTx(async (tx) => {
      const [inserted] = await tx.insert(worldbookTable).values({ name: dto.name, source: 'imported' }).returning()
      if (entries.length > 0) {
        await tx
          .insert(worldbookEntryTable)
          .values(entries.map((entry) => ({ ...stEntryToInsert(entry), worldbookId: inserted.id })))
      }
      return inserted
    })
    logger.info('Imported worldbook', { id: row.id, entries: entries.length, warnings: warnings.length })
    return { worldbook: await this.rowToWorldbook(row), warnings }
  }

  async exportSt(worldbookId: string): Promise<Record<string, unknown>> {
    await this.requireWorldbook(worldbookId)
    const entryRows = await this.db
      .select()
      .from(worldbookEntryTable)
      .where(eq(worldbookEntryTable.worldbookId, worldbookId))
    return exportWorldbook(entryRows.map(entryRowToStEntry))
  }

  // ---------- entries ----------

  async createEntry(worldbookId: string, dto: CreateWorldbookEntryDto): Promise<WorldbookEntry> {
    await this.requireWorldbook(worldbookId)
    const row = await this.dbService.withWriteTx(async (tx) => {
      const [inserted] = await tx
        .insert(worldbookEntryTable)
        .values({
          worldbookId,
          keys: dto.keys ?? [],
          secondaryKeys: dto.secondaryKeys,
          comment: dto.comment,
          content: dto.content,
          enabled: dto.enabled ?? true,
          constant: dto.constant ?? false,
          selective: dto.selective ?? false,
          selectiveLogic: dto.selectiveLogic,
          position: dto.position,
          depth: dto.depth,
          insertionOrder: dto.insertionOrder ?? 100,
          probability: dto.probability,
          useProbability: dto.useProbability,
          scanDepth: dto.scanDepth,
          caseSensitive: dto.caseSensitive,
          matchWholeWords: dto.matchWholeWords,
          role: dto.role,
          uid: dto.uid,
          extra: dto.extra
        })
        .returning()
      return inserted
    })
    logger.info('Created worldbook entry', { worldbookId, id: row.id })
    return rowToEntry(row)
  }

  async updateEntry(worldbookId: string, entryId: string, dto: UpdateWorldbookEntryDto): Promise<WorldbookEntry> {
    const row = await this.dbService.withWriteTx(async (tx) => {
      const updates: Partial<typeof worldbookEntryTable.$inferInsert> = {}
      for (const [key, value] of Object.entries(dto)) {
        if (value !== undefined) {
          ;(updates as Record<string, unknown>)[key] = value
        }
      }
      const [updated] = await tx
        .update(worldbookEntryTable)
        .set(updates)
        .where(and(eq(worldbookEntryTable.id, entryId), eq(worldbookEntryTable.worldbookId, worldbookId)))
        .returning()
      if (!updated) {
        throw DataApiErrorFactory.notFound('WorldbookEntry', entryId)
      }
      return updated
    })
    logger.info('Updated worldbook entry', { worldbookId, id: entryId, changes: Object.keys(dto) })
    return rowToEntry(row)
  }

  async deleteEntry(worldbookId: string, entryId: string): Promise<void> {
    const result = await this.dbService.withWriteTx((tx) =>
      tx
        .delete(worldbookEntryTable)
        .where(and(eq(worldbookEntryTable.id, entryId), eq(worldbookEntryTable.worldbookId, worldbookId)))
    )
    if (result.rowsAffected === 0) {
      throw DataApiErrorFactory.notFound('WorldbookEntry', entryId)
    }
    logger.info('Deleted worldbook entry', { worldbookId, id: entryId })
  }
}

export const worldbookService = new WorldbookService()
