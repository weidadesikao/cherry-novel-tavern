/**
 * Novel API Schema definitions
 *
 * Contains endpoints for Novel / Chapter / Entity / Relation CRUD plus ST
 * character card import & export.
 * Entity schemas and types live in `@shared/data/types/novel`.
 */

import * as z from 'zod'

import type { StWarning } from '../../../stCompat/types'
import {
  type Chapter,
  ChapterIdSchema as SharedChapterIdSchema,
  type ChapterMeta,
  ChapterSchema,
  NOVEL_TOPIC_PREFIX,
  type Novel,
  NovelChatConfigSchema,
  type NovelChatSession,
  type NovelEntity,
  NovelEntityCardSchema,
  NovelEntityIdSchema as SharedNovelEntityIdSchema,
  type NovelEntityRelation,
  NovelEntityRelationSchema,
  NovelEntitySchema,
  NovelIdSchema as SharedNovelIdSchema,
  NovelSchema,
  type TimelineEvent,
  TimelineEventIdSchema as SharedTimelineEventIdSchema,
  TimelineEventSchema
} from '../../types/novel'
import type { OrderRequest } from './_endpointHelpers'

export const NovelIdSchema = SharedNovelIdSchema
export const ChapterIdSchema = SharedChapterIdSchema
export const NovelEntityIdSchema = SharedNovelEntityIdSchema
export const RelationIdSchema = z.uuid()
export const TimelineEventIdSchema = SharedTimelineEventIdSchema

// ============================================================================
// DTOs
// ============================================================================

export const CreateNovelSchema = NovelSchema.pick({
  title: true,
  synopsis: true,
  creationMode: true
})
export type CreateNovelDto = z.infer<typeof CreateNovelSchema>

export const UpdateNovelSchema = z
  .strictObject({
    title: NovelSchema.shape.title.optional(),
    synopsis: NovelSchema.shape.synopsis.nullable().optional()
  })
  .refine((dto) => dto.title !== undefined || dto.synopsis !== undefined, {
    message: 'At least one field is required'
  })
export type UpdateNovelDto = z.infer<typeof UpdateNovelSchema>

export const CreateChapterSchema = z.strictObject({
  title: ChapterSchema.shape.title,
  content: z.string().optional(),
  outline: z.string().optional()
})
export type CreateChapterDto = z.infer<typeof CreateChapterSchema>

export const UpdateChapterSchema = z
  .strictObject({
    title: ChapterSchema.shape.title.optional(),
    content: z.string().optional(),
    outline: z.string().nullable().optional(),
    status: ChapterSchema.shape.status.optional()
  })
  .refine((dto) => Object.values(dto).some((value) => value !== undefined), {
    message: 'At least one field is required'
  })
export type UpdateChapterDto = z.infer<typeof UpdateChapterSchema>

export const CreateNovelEntitySchema = z.strictObject({
  type: NovelEntitySchema.shape.type,
  name: NovelEntitySchema.shape.name,
  card: NovelEntityCardSchema.optional()
})
export type CreateNovelEntityDto = z.infer<typeof CreateNovelEntitySchema>

export const UpdateNovelEntitySchema = z
  .strictObject({
    name: NovelEntitySchema.shape.name.optional(),
    type: NovelEntitySchema.shape.type.optional(),
    card: NovelEntityCardSchema.optional()
  })
  .refine((dto) => dto.name !== undefined || dto.type !== undefined || dto.card !== undefined, {
    message: 'At least one field is required'
  })
export type UpdateNovelEntityDto = z.infer<typeof UpdateNovelEntitySchema>

export const ImportStCardSchema = z.strictObject({
  /** Parsed JSON of a standard ST character card file. */
  json: z.unknown()
})
export type ImportStCardDto = z.infer<typeof ImportStCardSchema>

export const CreateRelationSchema = z.strictObject({
  fromEntityId: NovelEntityIdSchema,
  toEntityId: NovelEntityIdSchema,
  relationType: NovelEntityRelationSchema.shape.relationType,
  description: NovelEntityRelationSchema.shape.description
})
export type CreateRelationDto = z.infer<typeof CreateRelationSchema>

export const UpdateRelationSchema = z
  .strictObject({
    relationType: NovelEntityRelationSchema.shape.relationType.optional(),
    description: NovelEntityRelationSchema.shape.description.nullable().optional()
  })
  .refine((dto) => dto.relationType !== undefined || dto.description !== undefined, {
    message: 'At least one field is required'
  })
export type UpdateRelationDto = z.infer<typeof UpdateRelationSchema>

const TimelineEventEditableShape = TimelineEventSchema.omit({
  id: true,
  novelId: true,
  orderKey: true,
  createdAt: true,
  updatedAt: true
})

export const CreateTimelineEventSchema = TimelineEventEditableShape.partial().extend({
  title: TimelineEventSchema.shape.title
})
export type CreateTimelineEventDto = z.infer<typeof CreateTimelineEventSchema>

export const UpdateTimelineEventSchema = TimelineEventEditableShape.partial().refine(
  (dto) => Object.values(dto).some((value) => value !== undefined),
  { message: 'At least one field is required' }
)
export type UpdateTimelineEventDto = z.infer<typeof UpdateTimelineEventSchema>

export const NovelTopicIdSchema = z.string().startsWith(NOVEL_TOPIC_PREFIX)

export const GetNovelChatSessionQuerySchema = z.strictObject({
  chapterId: ChapterIdSchema
})

export const CreateNovelChatSessionSchema = z.strictObject({
  chapterId: ChapterIdSchema
})
export type CreateNovelChatSessionDto = z.infer<typeof CreateNovelChatSessionSchema>

export const UpdateNovelChatSessionSchema = z.strictObject({
  config: NovelChatConfigSchema
})
export type UpdateNovelChatSessionDto = z.infer<typeof UpdateNovelChatSessionSchema>

/** Dry-run of the main-side scaffold assembly — what the next send will look like. */
export interface NovelChatPreviewResponse {
  messages: Array<{ role: string; source: string; content: string }>
  stats: { included: number; world: number; worldTotal: number }
  warnings: string[]
}

// ============================================================================
// API Schema Definitions
// ============================================================================

export type NovelSchemas = {
  '/novels': {
    /** List all novels, most recently updated first */
    GET: {
      response: Novel[]
    }
    /** Create a new novel */
    POST: {
      body: CreateNovelDto
      response: Novel
    }
  }

  '/novels/:novelId': {
    /** Get a novel by ID */
    GET: {
      params: { novelId: string }
      response: Novel
    }
    /** Patch a novel */
    PATCH: {
      params: { novelId: string }
      body: UpdateNovelDto
      response: Novel
    }
    /** Delete a novel (cascades to chapters and entities) */
    DELETE: {
      params: { novelId: string }
      response: void
    }
  }

  '/novels/:novelId/chapters': {
    /** List chapter metadata (no content bodies), ordered by orderKey */
    GET: {
      params: { novelId: string }
      response: ChapterMeta[]
    }
    /** Create a chapter at the end of the novel */
    POST: {
      params: { novelId: string }
      body: CreateChapterDto
      response: Chapter
    }
  }

  '/novels/:novelId/chapters/:chapterId': {
    GET: {
      params: { novelId: string; chapterId: string }
      response: Chapter
    }
    PATCH: {
      params: { novelId: string; chapterId: string }
      body: UpdateChapterDto
      response: Chapter
    }
    DELETE: {
      params: { novelId: string; chapterId: string }
      response: void
    }
  }

  '/novels/:novelId/chapters/:chapterId/order': {
    PATCH: {
      params: { novelId: string; chapterId: string }
      body: OrderRequest
      response: void
    }
  }

  '/novels/:novelId/entities': {
    GET: {
      params: { novelId: string }
      response: NovelEntity[]
    }
    POST: {
      params: { novelId: string }
      body: CreateNovelEntityDto
      response: NovelEntity
    }
  }

  '/novels/:novelId/entities/:entityId': {
    GET: {
      params: { novelId: string; entityId: string }
      response: NovelEntity
    }
    PATCH: {
      params: { novelId: string; entityId: string }
      body: UpdateNovelEntityDto
      response: NovelEntity
    }
    DELETE: {
      params: { novelId: string; entityId: string }
      response: void
    }
  }

  /** Import a standard ST character card JSON as a character entity (dual-track: source file untouched) */
  '/novels/:novelId/entities/import:st': {
    POST: {
      params: { novelId: string }
      body: ImportStCardDto
      response: { entity: NovelEntity; warnings: StWarning[] }
    }
  }

  /** Export an entity as a standard ST character card V2 JSON object */
  '/novels/:novelId/entities/:entityId/export:st': {
    GET: {
      params: { novelId: string; entityId: string }
      response: Record<string, unknown>
    }
  }

  '/novels/:novelId/relations': {
    GET: {
      params: { novelId: string }
      response: NovelEntityRelation[]
    }
    POST: {
      params: { novelId: string }
      body: CreateRelationDto
      response: NovelEntityRelation
    }
  }

  '/novels/:novelId/relations/:relationId': {
    PATCH: {
      params: { novelId: string; relationId: string }
      body: UpdateRelationDto
      response: NovelEntityRelation
    }
    DELETE: {
      params: { novelId: string; relationId: string }
      response: void
    }
  }

  '/novels/:novelId/events': {
    /** List timeline events ordered by orderKey (the timeline sequence) */
    GET: {
      params: { novelId: string }
      response: TimelineEvent[]
    }
    POST: {
      params: { novelId: string }
      body: CreateTimelineEventDto
      response: TimelineEvent
    }
  }

  '/novels/:novelId/events/:eventId': {
    PATCH: {
      params: { novelId: string; eventId: string }
      body: UpdateTimelineEventDto
      response: TimelineEvent
    }
    DELETE: {
      params: { novelId: string; eventId: string }
      response: void
    }
  }

  '/novels/:novelId/events/:eventId/order': {
    PATCH: {
      params: { novelId: string; eventId: string }
      body: OrderRequest
      response: void
    }
  }

  '/novels/:novelId/chat-sessions': {
    /** Find this chapter's chat session (null when none was created yet). */
    GET: {
      params: { novelId: string }
      query?: { chapterId: string }
      response: NovelChatSession | null
    }
    /** Create a chat session for a chapter: a real `novel-…` topic row + the config row. */
    POST: {
      params: { novelId: string }
      body: CreateNovelChatSessionDto
      response: NovelChatSession
    }
  }

  '/novels/:novelId/chat-sessions/:topicId': {
    /** Replace the session's ST-asset/context config (workbench toolbar state). */
    PATCH: {
      params: { novelId: string; topicId: string }
      body: UpdateNovelChatSessionDto
      response: NovelChatSession
    }
  }

  /** Dry-run assembly of the next send (same code path the provider uses). */
  '/novels/:novelId/chat-sessions/:topicId/preview': {
    GET: {
      params: { novelId: string; topicId: string }
      response: NovelChatPreviewResponse
    }
  }
}
