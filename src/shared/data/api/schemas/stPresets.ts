/**
 * ST Preset API Schema definitions
 *
 * Presets are stored as the verbatim imported JSON (dual-track external
 * snapshot): import validates and warns via the stCompat engine but never
 * rewrites the document; export returns it unchanged.
 */

import * as z from 'zod'

import type { StWarning } from '../../../stCompat/types'
import { StPresetIdSchema as SharedStPresetIdSchema, type StPresetMeta, StPresetMetaSchema } from '../../types/novel'

export const StPresetIdSchema = SharedStPresetIdSchema

// ============================================================================
// DTOs
// ============================================================================

export const ImportStPresetSchema = z.strictObject({
  name: StPresetMetaSchema.shape.name,
  /** Parsed JSON of a standard ST preset file — stored verbatim. */
  json: z.unknown()
})
export type ImportStPresetDto = z.infer<typeof ImportStPresetSchema>

export const UpdateStPresetSchema = z
  .strictObject({
    name: StPresetMetaSchema.shape.name.optional(),
    /** Replacement verbatim JSON (edited via the asset JSON dialog); stored as-is. */
    json: z.unknown().optional()
  })
  .refine((dto) => dto.name !== undefined || dto.json !== undefined, {
    message: 'At least one field is required'
  })
export type UpdateStPresetDto = z.infer<typeof UpdateStPresetSchema>

// ============================================================================
// API Schema Definitions
// ============================================================================

export type StPresetSchemas = {
  '/st-presets': {
    GET: {
      response: StPresetMeta[]
    }
    /** Import an ST preset (stored verbatim; warnings report unsupported features) */
    POST: {
      body: ImportStPresetDto
      response: { preset: StPresetMeta; warnings: StWarning[] }
    }
  }

  '/st-presets/:presetId': {
    /** Returns the verbatim preset JSON alongside the meta (also serves export) */
    GET: {
      params: { presetId: string }
      response: StPresetMeta & { json: Record<string, unknown> }
    }
    PATCH: {
      params: { presetId: string }
      body: UpdateStPresetDto
      response: StPresetMeta
    }
    DELETE: {
      params: { presetId: string }
      response: void
    }
  }
}
