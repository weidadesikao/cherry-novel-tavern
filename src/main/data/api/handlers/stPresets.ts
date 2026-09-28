/**
 * ST Preset API Handlers
 *
 * All input validation happens here at the IPC trust boundary. Business logic
 * lives in StPresetService.
 */

import { stPresetService } from '@data/services/StPresetService'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import {
  ImportStPresetSchema,
  StPresetIdSchema,
  type StPresetSchemas,
  UpdateStPresetSchema
} from '@shared/data/api/schemas/stPresets'

export const stPresetHandlers: HandlersFor<StPresetSchemas> = {
  '/st-presets': {
    GET: async () => {
      return await stPresetService.list()
    },

    POST: async ({ body }) => {
      const parsed = ImportStPresetSchema.parse(body)
      return await stPresetService.import(parsed)
    }
  },

  '/st-presets/:presetId': {
    GET: async ({ params }) => {
      const id = StPresetIdSchema.parse(params.presetId)
      return await stPresetService.getById(id)
    },

    PATCH: async ({ params, body }) => {
      const id = StPresetIdSchema.parse(params.presetId)
      const parsed = UpdateStPresetSchema.parse(body)
      return await stPresetService.update(id, parsed)
    },

    DELETE: async ({ params }) => {
      const id = StPresetIdSchema.parse(params.presetId)
      await stPresetService.delete(id)
      return undefined
    }
  }
}
