/**
 * Worldbook API Schema definitions
 *
 * Worldbooks are global ST-compatible assets (not novel-scoped). Import keeps
 * the source file untouched (dual-track); export regenerates a standard ST
 * world info JSON from the internal tables, lossless via `extra`.
 */

import * as z from 'zod'

import type { StWarning } from '../../../stCompat/types'
import {
  type Worldbook,
  type WorldbookEntry,
  WorldbookEntrySchema,
  WorldbookIdSchema as SharedWorldbookIdSchema,
  WorldbookSchema
} from '../../types/novel'

export const WorldbookIdSchema = SharedWorldbookIdSchema
export const WorldbookEntryIdSchema = z.uuid()

// ============================================================================
// DTOs
// ============================================================================

export const CreateWorldbookSchema = z.strictObject({
  name: WorldbookSchema.shape.name,
  description: WorldbookSchema.shape.description
})
export type CreateWorldbookDto = z.infer<typeof CreateWorldbookSchema>

export const UpdateWorldbookSchema = z
  .strictObject({
    name: WorldbookSchema.shape.name.optional(),
    description: WorldbookSchema.shape.description.nullable().optional()
  })
  .refine((dto) => dto.name !== undefined || dto.description !== undefined, {
    message: 'At least one field is required'
  })
export type UpdateWorldbookDto = z.infer<typeof UpdateWorldbookSchema>

export const ImportWorldbookSchema = z.strictObject({
  name: WorldbookSchema.shape.name,
  /** Parsed JSON of a standard ST world info file. */
  json: z.unknown(),
  /** When set, replace this worldbook's entries (and name) instead of creating a new one. */
  worldbookId: WorldbookIdSchema.optional()
})
export type ImportWorldbookDto = z.infer<typeof ImportWorldbookSchema>

const WorldbookEntryEditableShape = WorldbookEntrySchema.omit({
  id: true,
  worldbookId: true,
  createdAt: true,
  updatedAt: true
})

export const CreateWorldbookEntrySchema = WorldbookEntryEditableShape.partial().extend({
  content: z.string()
})
export type CreateWorldbookEntryDto = z.infer<typeof CreateWorldbookEntrySchema>

export const UpdateWorldbookEntrySchema = WorldbookEntryEditableShape.partial().refine(
  (dto) => Object.values(dto).some((value) => value !== undefined),
  { message: 'At least one field is required' }
)
export type UpdateWorldbookEntryDto = z.infer<typeof UpdateWorldbookEntrySchema>

// ============================================================================
// API Schema Definitions
// ============================================================================

export type WorldbookSchemas = {
  '/worldbooks': {
    /** List worldbooks with entry counts */
    GET: {
      response: Worldbook[]
    }
    /** Create an empty worldbook */
    POST: {
      body: CreateWorldbookDto
      response: Worldbook
    }
  }

  /** Import a standard ST world info JSON file */
  '/worldbooks/import:st': {
    POST: {
      body: ImportWorldbookDto
      response: { worldbook: Worldbook; warnings: StWarning[] }
    }
  }

  '/worldbooks/:worldbookId': {
    GET: {
      params: { worldbookId: string }
      response: { worldbook: Worldbook; entries: WorldbookEntry[] }
    }
    PATCH: {
      params: { worldbookId: string }
      body: UpdateWorldbookDto
      response: Worldbook
    }
    DELETE: {
      params: { worldbookId: string }
      response: void
    }
  }

  /** Export as a standard ST world info JSON object */
  '/worldbooks/:worldbookId/export:st': {
    GET: {
      params: { worldbookId: string }
      response: Record<string, unknown>
    }
  }

  '/worldbooks/:worldbookId/entries': {
    POST: {
      params: { worldbookId: string }
      body: CreateWorldbookEntryDto
      response: WorldbookEntry
    }
  }

  '/worldbooks/:worldbookId/entries/:entryId': {
    PATCH: {
      params: { worldbookId: string; entryId: string }
      body: UpdateWorldbookEntryDto
      response: WorldbookEntry
    }
    DELETE: {
      params: { worldbookId: string; entryId: string }
      response: void
    }
  }
}
