/**
 * ST Preset Service - SillyTavern presets stored as the verbatim imported JSON
 * (external-table half of the dual-track rule).
 *
 * Import validates and surfaces warnings via the stCompat engine but never
 * rewrites the document; export / GET returns it unchanged.
 */

import { application } from '@application'
import { type StPresetRow, stPresetTable } from '@data/db/schemas/stPreset'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { ImportStPresetDto, UpdateStPresetDto } from '@shared/data/api/schemas/stPresets'
import type { StPresetMeta } from '@shared/data/types/novel'
import { parsePreset } from '@shared/stCompat'
import type { StWarning } from '@shared/stCompat/types'
import { desc, eq } from 'drizzle-orm'

import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:StPresetService')

function rowToMeta(row: StPresetRow): StPresetMeta {
  return {
    id: row.id,
    name: row.name,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

export class StPresetService {
  private get dbService() {
    return application.get('DbService')
  }

  private get db() {
    return this.dbService.getDb()
  }

  private async requirePreset(presetId: string): Promise<StPresetRow> {
    const [row] = await this.db.select().from(stPresetTable).where(eq(stPresetTable.id, presetId)).limit(1)
    if (!row) {
      throw DataApiErrorFactory.notFound('StPreset', presetId)
    }
    return row
  }

  async list(): Promise<StPresetMeta[]> {
    const rows = await this.db.select().from(stPresetTable).orderBy(desc(stPresetTable.updatedAt))
    return rows.map(rowToMeta)
  }

  async getById(presetId: string): Promise<StPresetMeta & { json: Record<string, unknown> }> {
    const row = await this.requirePreset(presetId)
    return { ...rowToMeta(row), json: row.json }
  }

  async import(dto: ImportStPresetDto): Promise<{ preset: StPresetMeta; warnings: StWarning[] }> {
    // Parse for warnings only; the document is stored exactly as received.
    const { warnings } = parsePreset(dto.json)

    const row = await this.dbService.withWriteTx(async (tx) => {
      const [inserted] = await tx
        .insert(stPresetTable)
        .values({ name: dto.name, json: dto.json as Record<string, unknown> })
        .returning()
      return inserted
    })
    logger.info('Imported ST preset', { id: row.id, warnings: warnings.length })
    return { preset: rowToMeta(row), warnings }
  }

  async update(presetId: string, dto: UpdateStPresetDto): Promise<StPresetMeta> {
    const set: Partial<Pick<StPresetRow, 'name' | 'json'>> = {}
    if (dto.name !== undefined) set.name = dto.name
    if (dto.json !== undefined) {
      // Same contract as import: parse for warnings only, store verbatim.
      const { warnings } = parsePreset(dto.json)
      logger.info('Replacing ST preset JSON', { id: presetId, warnings: warnings.length })
      set.json = dto.json as Record<string, unknown>
    }
    const row = await this.dbService.withWriteTx(async (tx) => {
      const [updated] = await tx.update(stPresetTable).set(set).where(eq(stPresetTable.id, presetId)).returning()
      if (!updated) {
        throw DataApiErrorFactory.notFound('StPreset', presetId)
      }
      return updated
    })
    logger.info('Updated ST preset', { id: presetId })
    return rowToMeta(row)
  }

  async delete(presetId: string): Promise<void> {
    const result = await this.dbService.withWriteTx((tx) =>
      tx.delete(stPresetTable).where(eq(stPresetTable.id, presetId))
    )
    if (result.rowsAffected === 0) {
      throw DataApiErrorFactory.notFound('StPreset', presetId)
    }
    logger.info('Deleted ST preset', { id: presetId })
  }
}

export const stPresetService = new StPresetService()
