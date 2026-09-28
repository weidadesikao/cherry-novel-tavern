/**
 * Worldbook API Handlers
 *
 * All input validation happens here at the IPC trust boundary. Business logic
 * lives in WorldbookService.
 */

import { worldbookService } from '@data/services/WorldbookService'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import {
  CreateWorldbookEntrySchema,
  CreateWorldbookSchema,
  ImportWorldbookSchema,
  UpdateWorldbookEntrySchema,
  UpdateWorldbookSchema,
  WorldbookEntryIdSchema,
  WorldbookIdSchema,
  type WorldbookSchemas
} from '@shared/data/api/schemas/worldbooks'

export const worldbookHandlers: HandlersFor<WorldbookSchemas> = {
  '/worldbooks': {
    GET: async () => {
      return await worldbookService.list()
    },

    POST: async ({ body }) => {
      const parsed = CreateWorldbookSchema.parse(body)
      return await worldbookService.create(parsed)
    }
  },

  '/worldbooks/import:st': {
    POST: async ({ body }) => {
      const parsed = ImportWorldbookSchema.parse(body)
      return await worldbookService.importSt(parsed)
    }
  },

  '/worldbooks/:worldbookId': {
    GET: async ({ params }) => {
      const id = WorldbookIdSchema.parse(params.worldbookId)
      return await worldbookService.getById(id)
    },

    PATCH: async ({ params, body }) => {
      const id = WorldbookIdSchema.parse(params.worldbookId)
      const parsed = UpdateWorldbookSchema.parse(body)
      return await worldbookService.update(id, parsed)
    },

    DELETE: async ({ params }) => {
      const id = WorldbookIdSchema.parse(params.worldbookId)
      await worldbookService.delete(id)
      return undefined
    }
  },

  '/worldbooks/:worldbookId/export:st': {
    GET: async ({ params }) => {
      const id = WorldbookIdSchema.parse(params.worldbookId)
      return await worldbookService.exportSt(id)
    }
  },

  '/worldbooks/:worldbookId/entries': {
    POST: async ({ params, body }) => {
      const id = WorldbookIdSchema.parse(params.worldbookId)
      const parsed = CreateWorldbookEntrySchema.parse(body)
      return await worldbookService.createEntry(id, parsed)
    }
  },

  '/worldbooks/:worldbookId/entries/:entryId': {
    PATCH: async ({ params, body }) => {
      const id = WorldbookIdSchema.parse(params.worldbookId)
      const entryId = WorldbookEntryIdSchema.parse(params.entryId)
      const parsed = UpdateWorldbookEntrySchema.parse(body)
      return await worldbookService.updateEntry(id, entryId, parsed)
    },

    DELETE: async ({ params }) => {
      const id = WorldbookIdSchema.parse(params.worldbookId)
      const entryId = WorldbookEntryIdSchema.parse(params.entryId)
      await worldbookService.deleteEntry(id, entryId)
      return undefined
    }
  }
}
