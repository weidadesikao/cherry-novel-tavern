/**
 * Novel API Handlers
 *
 * All input validation happens here at the IPC trust boundary. Business logic
 * lives in the Novel* services.
 */

import { novelChapterService } from '@data/services/NovelChapterService'
import { novelChatSessionService } from '@data/services/NovelChatSessionService'
import { novelEntityService } from '@data/services/NovelEntityService'
import { novelService } from '@data/services/NovelService'
import { novelTimelineService } from '@data/services/NovelTimelineService'
import { topicService } from '@data/services/TopicService'
import { messageService } from '@main/data/services/MessageService'
import { previewNovelScaffold } from '@main/services/novel/novelChatScaffold'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import { OrderRequestSchema } from '@shared/data/api/schemas/_endpointHelpers'
import {
  ChapterIdSchema,
  CreateChapterSchema,
  CreateNovelChatSessionSchema,
  CreateNovelEntitySchema,
  CreateNovelSchema,
  CreateRelationSchema,
  CreateTimelineEventSchema,
  GetNovelChatSessionQuerySchema,
  ImportStCardSchema,
  NovelEntityIdSchema,
  NovelIdSchema,
  type NovelSchemas,
  NovelTopicIdSchema,
  RelationIdSchema,
  TimelineEventIdSchema,
  UpdateChapterSchema,
  UpdateNovelChatSessionSchema,
  UpdateNovelEntitySchema,
  UpdateNovelSchema,
  UpdateRelationSchema,
  UpdateTimelineEventSchema
} from '@shared/data/api/schemas/novels'
import type { CherryUIMessage } from '@shared/data/types/message'

export const novelHandlers: HandlersFor<NovelSchemas> = {
  '/novels': {
    GET: async () => {
      return await novelService.list()
    },

    POST: async ({ body }) => {
      const parsed = CreateNovelSchema.parse(body)
      return await novelService.create(parsed)
    }
  },

  '/novels/:novelId': {
    GET: async ({ params }) => {
      const id = NovelIdSchema.parse(params.novelId)
      return await novelService.getById(id)
    },

    PATCH: async ({ params, body }) => {
      const id = NovelIdSchema.parse(params.novelId)
      const parsed = UpdateNovelSchema.parse(body)
      return await novelService.update(id, parsed)
    },

    DELETE: async ({ params }) => {
      const id = NovelIdSchema.parse(params.novelId)
      await novelService.delete(id)
      return undefined
    }
  },

  '/novels/:novelId/chapters': {
    GET: async ({ params }) => {
      const novelId = NovelIdSchema.parse(params.novelId)
      return await novelChapterService.list(novelId)
    },

    POST: async ({ params, body }) => {
      const novelId = NovelIdSchema.parse(params.novelId)
      const parsed = CreateChapterSchema.parse(body)
      return await novelChapterService.create(novelId, parsed)
    }
  },

  '/novels/:novelId/chapters/:chapterId': {
    GET: async ({ params }) => {
      const novelId = NovelIdSchema.parse(params.novelId)
      const chapterId = ChapterIdSchema.parse(params.chapterId)
      return await novelChapterService.getById(novelId, chapterId)
    },

    PATCH: async ({ params, body }) => {
      const novelId = NovelIdSchema.parse(params.novelId)
      const chapterId = ChapterIdSchema.parse(params.chapterId)
      const parsed = UpdateChapterSchema.parse(body)
      return await novelChapterService.update(novelId, chapterId, parsed)
    },

    DELETE: async ({ params }) => {
      const novelId = NovelIdSchema.parse(params.novelId)
      const chapterId = ChapterIdSchema.parse(params.chapterId)
      await novelChapterService.delete(novelId, chapterId)
      return undefined
    }
  },

  '/novels/:novelId/chapters/:chapterId/order': {
    PATCH: async ({ params, body }) => {
      const novelId = NovelIdSchema.parse(params.novelId)
      const chapterId = ChapterIdSchema.parse(params.chapterId)
      const anchor = OrderRequestSchema.parse(body)
      await novelChapterService.reorder(novelId, chapterId, anchor)
      return undefined
    }
  },

  '/novels/:novelId/entities': {
    GET: async ({ params }) => {
      const novelId = NovelIdSchema.parse(params.novelId)
      return await novelEntityService.list(novelId)
    },

    POST: async ({ params, body }) => {
      const novelId = NovelIdSchema.parse(params.novelId)
      const parsed = CreateNovelEntitySchema.parse(body)
      return await novelEntityService.create(novelId, parsed)
    }
  },

  '/novels/:novelId/entities/:entityId': {
    GET: async ({ params }) => {
      const novelId = NovelIdSchema.parse(params.novelId)
      const entityId = NovelEntityIdSchema.parse(params.entityId)
      return await novelEntityService.getById(novelId, entityId)
    },

    PATCH: async ({ params, body }) => {
      const novelId = NovelIdSchema.parse(params.novelId)
      const entityId = NovelEntityIdSchema.parse(params.entityId)
      const parsed = UpdateNovelEntitySchema.parse(body)
      return await novelEntityService.update(novelId, entityId, parsed)
    },

    DELETE: async ({ params }) => {
      const novelId = NovelIdSchema.parse(params.novelId)
      const entityId = NovelEntityIdSchema.parse(params.entityId)
      await novelEntityService.delete(novelId, entityId)
      return undefined
    }
  },

  '/novels/:novelId/entities/import:st': {
    POST: async ({ params, body }) => {
      const novelId = NovelIdSchema.parse(params.novelId)
      const parsed = ImportStCardSchema.parse(body)
      return await novelEntityService.importStCard(novelId, parsed.json)
    }
  },

  '/novels/:novelId/entities/:entityId/export:st': {
    GET: async ({ params }) => {
      const novelId = NovelIdSchema.parse(params.novelId)
      const entityId = NovelEntityIdSchema.parse(params.entityId)
      return await novelEntityService.exportStCard(novelId, entityId)
    }
  },

  '/novels/:novelId/relations': {
    GET: async ({ params }) => {
      const novelId = NovelIdSchema.parse(params.novelId)
      return await novelEntityService.listRelations(novelId)
    },

    POST: async ({ params, body }) => {
      const novelId = NovelIdSchema.parse(params.novelId)
      const parsed = CreateRelationSchema.parse(body)
      return await novelEntityService.createRelation(novelId, parsed)
    }
  },

  '/novels/:novelId/relations/:relationId': {
    PATCH: async ({ params, body }) => {
      const novelId = NovelIdSchema.parse(params.novelId)
      const relationId = RelationIdSchema.parse(params.relationId)
      const parsed = UpdateRelationSchema.parse(body)
      return await novelEntityService.updateRelation(novelId, relationId, parsed)
    },

    DELETE: async ({ params }) => {
      const novelId = NovelIdSchema.parse(params.novelId)
      const relationId = RelationIdSchema.parse(params.relationId)
      await novelEntityService.deleteRelation(novelId, relationId)
      return undefined
    }
  },

  '/novels/:novelId/events': {
    GET: async ({ params }) => {
      const novelId = NovelIdSchema.parse(params.novelId)
      return await novelTimelineService.list(novelId)
    },

    POST: async ({ params, body }) => {
      const novelId = NovelIdSchema.parse(params.novelId)
      const parsed = CreateTimelineEventSchema.parse(body)
      return await novelTimelineService.create(novelId, parsed)
    }
  },

  '/novels/:novelId/events/:eventId': {
    PATCH: async ({ params, body }) => {
      const novelId = NovelIdSchema.parse(params.novelId)
      const eventId = TimelineEventIdSchema.parse(params.eventId)
      const parsed = UpdateTimelineEventSchema.parse(body)
      return await novelTimelineService.update(novelId, eventId, parsed)
    },

    DELETE: async ({ params }) => {
      const novelId = NovelIdSchema.parse(params.novelId)
      const eventId = TimelineEventIdSchema.parse(params.eventId)
      await novelTimelineService.delete(novelId, eventId)
      return undefined
    }
  },

  '/novels/:novelId/events/:eventId/order': {
    PATCH: async ({ params, body }) => {
      const novelId = NovelIdSchema.parse(params.novelId)
      const eventId = TimelineEventIdSchema.parse(params.eventId)
      const anchor = OrderRequestSchema.parse(body)
      await novelTimelineService.reorder(novelId, eventId, anchor)
      return undefined
    }
  },

  '/novels/:novelId/chat-sessions': {
    GET: async ({ params, query }) => {
      const novelId = NovelIdSchema.parse(params.novelId)
      const { chapterId } = GetNovelChatSessionQuerySchema.parse(query ?? {})
      return await novelChatSessionService.getByChapter(novelId, chapterId)
    },

    POST: async ({ params, body }) => {
      const novelId = NovelIdSchema.parse(params.novelId)
      const parsed = CreateNovelChatSessionSchema.parse(body)
      return await novelChatSessionService.create(novelId, parsed.chapterId)
    }
  },

  '/novels/:novelId/chat-sessions/:topicId': {
    PATCH: async ({ params, body }) => {
      const novelId = NovelIdSchema.parse(params.novelId)
      const topicId = NovelTopicIdSchema.parse(params.topicId)
      const parsed = UpdateNovelChatSessionSchema.parse(body)
      return await novelChatSessionService.updateConfig(novelId, topicId, parsed.config)
    }
  },

  '/novels/:novelId/chat-sessions/:topicId/preview': {
    GET: async ({ params }) => {
      NovelIdSchema.parse(params.novelId)
      const topicId = NovelTopicIdSchema.parse(params.topicId)
      // Current active conversation path + a placeholder for the next input —
      // mirrors what the provider will assemble on the actual send.
      const topic = await topicService.getById(topicId)
      const path = topic.activeNodeId ? await messageService.getPathToNode(topic.activeNodeId) : []
      const history: CherryUIMessage[] = path.map((message) => ({
        id: message.id,
        role: message.role,
        parts: message.data.parts ?? []
      }))
      history.push({ id: 'preview-user', role: 'user', parts: [{ type: 'text', text: '（你的下一条指令）' }] })
      return await previewNovelScaffold(topicId, history)
    }
  }
}
