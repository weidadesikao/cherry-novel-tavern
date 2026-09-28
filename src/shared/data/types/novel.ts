/**
 * Novel Studio entity types
 *
 * Novels, chapters, entity cards, worldbooks and SillyTavern presets for the
 * novel writing feature. ST-compatible assets follow the dual-track rule:
 * imported JSON files are never mutated; these types describe the internal
 * tables that AI/user edits operate on.
 */

import * as z from 'zod'

// ============================================================================
// Novel
// ============================================================================

export const NovelIdSchema = z.uuid()

export const NOVEL_TITLE_MAX = 256
export const NOVEL_SYNOPSIS_MAX = 10_000

export const NovelCreationModeSchema = z.enum(['structured', 'remodel', 'free', 'imported'])
export type NovelCreationMode = z.infer<typeof NovelCreationModeSchema>

export const NovelTitleSchema = z.string().trim().min(1).max(NOVEL_TITLE_MAX)

/** Complete Novel entity as returned by the API. */
export const NovelSchema = z.strictObject({
  id: NovelIdSchema,
  title: NovelTitleSchema,
  synopsis: z.string().max(NOVEL_SYNOPSIS_MAX).optional(),
  creationMode: NovelCreationModeSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})
export type Novel = z.infer<typeof NovelSchema>

// ============================================================================
// Chapter
// ============================================================================

export const ChapterStatusSchema = z.enum(['draft', 'completed'])
export type ChapterStatus = z.infer<typeof ChapterStatusSchema>

export const ChapterIdSchema = z.uuid()
export const CHAPTER_TITLE_MAX = 256

/** List/meta view — excludes the (potentially large) content body. */
export const ChapterMetaSchema = z.strictObject({
  id: ChapterIdSchema,
  novelId: NovelIdSchema,
  title: z.string().trim().min(1).max(CHAPTER_TITLE_MAX),
  status: ChapterStatusSchema,
  wordCount: z.number().int().min(0),
  orderKey: z.string().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})
export type ChapterMeta = z.infer<typeof ChapterMetaSchema>

export const ChapterSchema = ChapterMetaSchema.extend({
  content: z.string(),
  outline: z.string().optional()
})
export type Chapter = z.infer<typeof ChapterSchema>

// ============================================================================
// Entity cards (characters / locations / items / organizations)
// ============================================================================

export const NovelEntityTypeSchema = z.enum(['character', 'location', 'item', 'organization', 'other'])
export type NovelEntityType = z.infer<typeof NovelEntityTypeSchema>

/**
 * Internal entity card content. Core fields are aligned with the ST Character
 * Card spec (camelCased; converted to snake_case on export); the richer
 * narrative fields below back the character-card detail view (PRD §3.2). All
 * fields are optional so non-character entities can reuse the same shape and
 * partially-filled cards are valid.
 */
export const NovelEntityCardSchema = z.object({
  // ST Character Card core
  description: z.string().optional(),
  personality: z.string().optional(),
  scenario: z.string().optional(),
  firstMes: z.string().optional(),
  mesExample: z.string().optional(),
  creatorNotes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  // Rich narrative profile (character-card detail view)
  /** Other names / nicknames the character is referred to by. Drives alias canonicalization. */
  aliases: z.array(z.string()).optional(),
  /** Narrative role: 主角 / 配角 / 反派 / 龙套 … (free text). */
  role: z.string().optional(),
  /** Presence status: 活跃在场 / 已退场 / 死亡 … (free text). */
  status: z.string().optional(),
  /** Affiliated organization / faction name. */
  affiliation: z.string().optional(),
  /** Physical appearance description. */
  appearance: z.string().optional(),
  /** Background story / history. */
  background: z.string().optional(),
  /** How the character's state or allegiance shifts over the story. */
  statusChanges: z.string().optional(),
  /** Free-form user-defined fields not covered above. */
  extra: z.record(z.string(), z.string()).optional()
})
export type NovelEntityCard = z.infer<typeof NovelEntityCardSchema>

export const NovelEntityIdSchema = z.uuid()
export const NOVEL_ENTITY_NAME_MAX = 256

export const NovelEntitySchema = z.strictObject({
  id: NovelEntityIdSchema,
  novelId: NovelIdSchema,
  type: NovelEntityTypeSchema,
  name: z.string().trim().min(1).max(NOVEL_ENTITY_NAME_MAX),
  card: NovelEntityCardSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})
export type NovelEntity = z.infer<typeof NovelEntitySchema>

export const NovelEntityRelationSchema = z.strictObject({
  id: z.uuid(),
  novelId: NovelIdSchema,
  fromEntityId: NovelEntityIdSchema,
  toEntityId: NovelEntityIdSchema,
  relationType: z.string().trim().min(1).max(64),
  description: z.string().max(2000).optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})
export type NovelEntityRelation = z.infer<typeof NovelEntityRelationSchema>

// ============================================================================
// Timeline event (StoryEvent) — the timeline view is these rows ordered
// ============================================================================

/** plot=主线情节 turn=转折 reveal=揭示/伏笔 conflict=冲突对抗 daily=日常过渡 other=其他 */
export const TimelineEventTypeSchema = z.enum(['plot', 'turn', 'reveal', 'conflict', 'daily', 'other'])
export type TimelineEventType = z.infer<typeof TimelineEventTypeSchema>

export const TimelineEventIdSchema = z.uuid()
export const TIMELINE_EVENT_TITLE_MAX = 256

export const TimelineEventSchema = z.strictObject({
  id: TimelineEventIdSchema,
  novelId: NovelIdSchema,
  title: z.string().trim().min(1).max(TIMELINE_EVENT_TITLE_MAX),
  summary: z.string(),
  eventType: TimelineEventTypeSchema,
  /** In-story (diegetic) time as free text, e.g. "春游当日". */
  storyTime: z.string().optional(),
  location: z.string().optional(),
  /** Involved entity names. */
  participants: z.array(z.string()).optional(),
  /** Anchoring chapter id, if known. */
  chapterId: ChapterIdSchema.optional(),
  orderKey: z.string().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})
export type TimelineEvent = z.infer<typeof TimelineEventSchema>

// ============================================================================
// Worldbook
// ============================================================================

export const WorldbookSourceSchema = z.enum(['imported', 'created'])
export type WorldbookSource = z.infer<typeof WorldbookSourceSchema>

export const WorldbookIdSchema = z.uuid()

export const WorldbookSchema = z.strictObject({
  id: WorldbookIdSchema,
  name: z.string().trim().min(1).max(256),
  description: z.string().max(2000).optional(),
  source: WorldbookSourceSchema,
  entryCount: z.number().int().min(0),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})
export type Worldbook = z.infer<typeof WorldbookSchema>

/** API view of a worldbook entry — engine StWorldbookEntry fields + identity. */
export const WorldbookEntrySchema = z.strictObject({
  id: z.uuid(),
  worldbookId: WorldbookIdSchema,
  uid: z.number().int().optional(),
  keys: z.array(z.string()),
  secondaryKeys: z.array(z.string()).optional(),
  comment: z.string().optional(),
  content: z.string(),
  enabled: z.boolean(),
  constant: z.boolean(),
  selective: z.boolean(),
  selectiveLogic: z.number().int().optional(),
  position: z.number().int().optional(),
  depth: z.number().int().optional(),
  insertionOrder: z.number().int(),
  probability: z.number().optional(),
  useProbability: z.boolean().optional(),
  scanDepth: z.number().int().optional(),
  caseSensitive: z.boolean().optional(),
  matchWholeWords: z.boolean().optional(),
  role: z.enum(['system', 'user', 'assistant']).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})
export type WorldbookEntry = z.infer<typeof WorldbookEntrySchema>

// ============================================================================
// ST Preset
// ============================================================================

export const StPresetIdSchema = z.uuid()

export const StPresetMetaSchema = z.strictObject({
  id: StPresetIdSchema,
  name: z.string().trim().min(1).max(256),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})
export type StPresetMeta = z.infer<typeof StPresetMetaSchema>

// ============================================================================
// Novel chat session (M10) — a real chat topic grafted onto the workbench.
// The row binds a `novel-…` topic id to a chapter and stores the ST-asset
// selections the main-side NovelChatContextProvider assembles from per send.
// ============================================================================

/** Topic ids for novel chat sessions carry this prefix (provider routing key). */
export const NOVEL_TOPIC_PREFIX = 'novel-'

export const NOVEL_CHAT_SYSTEM_PROMPT_MAX = 20_000

export const NovelReferenceModeSchema = z.enum(['fact', 'style', 'imitate'])
export type NovelReferenceMode = z.infer<typeof NovelReferenceModeSchema>

/** History-rounds sentinel: replay the whole conversation (mirrors M9's ROUNDS_ALL). */
export const NOVEL_HISTORY_ROUNDS_ALL = -1

/** ST-asset + context selections, the M9 workbench toolbar persisted per session. */
export const NovelChatConfigSchema = z.strictObject({
  presetId: StPresetIdSchema.optional(),
  worldbookId: WorldbookIdSchema.optional(),
  entityIds: z.array(NovelEntityIdSchema).default([]),
  /** Which of the preset's prompt_order lists drives assembly (ST default 100001). */
  orderCharacterId: z.string().optional(),
  carryTimeline: z.boolean().default(false),
  /** How many previous chapters ride along in the writing context. */
  prevChapterCount: z.number().int().min(0).max(10).default(0),
  /** Editable writing-context header; empty/undefined = built-in default. */
  systemPrompt: z.string().max(NOVEL_CHAT_SYSTEM_PROMPT_MAX).optional(),
  /** How many trailing user/assistant TURNS (pairs) ride along; NOVEL_HISTORY_ROUNDS_ALL = all. */
  historyRounds: z.number().int().min(NOVEL_HISTORY_ROUNDS_ALL).default(NOVEL_HISTORY_ROUNDS_ALL),
  /** Knowledge-base reference mode (PRD §5, mirrors M9's novelReference.ts). */
  knowledgeBaseId: z.string().optional(),
  referenceMode: NovelReferenceModeSchema.default('fact'),
  webSearchEnabled: z.boolean().default(false)
})
export type NovelChatConfig = z.infer<typeof NovelChatConfigSchema>

export const NovelChatSessionSchema = z.strictObject({
  topicId: z.string().startsWith(NOVEL_TOPIC_PREFIX),
  novelId: NovelIdSchema,
  chapterId: ChapterIdSchema,
  /** Per-novel dedicated assistant driving the embedded chat's capabilities. */
  assistantId: z.string().min(1).optional(),
  config: NovelChatConfigSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})
export type NovelChatSession = z.infer<typeof NovelChatSessionSchema>
