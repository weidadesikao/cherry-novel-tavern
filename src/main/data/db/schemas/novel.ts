import type { ChapterStatus, NovelChatConfig, NovelCreationMode, TimelineEventType } from '@shared/data/types/novel'
import { sql } from 'drizzle-orm'
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import {
  createUpdateTimestamps,
  orderKeyColumns,
  scopedOrderKeyIndex,
  uuidPrimaryKey,
  uuidPrimaryKeyOrdered
} from './_columnHelpers'

export const novelTable = sqliteTable(
  'novel',
  {
    id: uuidPrimaryKey(),
    title: text().notNull(),
    synopsis: text(),
    creationMode: text().$type<NovelCreationMode>().notNull(),
    ...createUpdateTimestamps
  },
  (t) => [check('novel_creation_mode_check', sql`${t.creationMode} IN ('structured', 'remodel', 'free', 'imported')`)]
)

export type NovelRow = typeof novelTable.$inferSelect
export type InsertNovelRow = typeof novelTable.$inferInsert

export const novelChapterTable = sqliteTable(
  'novel_chapter',
  {
    id: uuidPrimaryKeyOrdered(),
    novelId: text()
      .notNull()
      .references(() => novelTable.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    content: text().notNull().default(''),
    outline: text(),
    status: text().$type<ChapterStatus>().notNull().default('draft'),
    wordCount: integer().notNull().default(0),
    ...orderKeyColumns,
    ...createUpdateTimestamps
  },
  (t) => [
    check('novel_chapter_status_check', sql`${t.status} IN ('draft', 'completed')`),
    scopedOrderKeyIndex('novel_chapter', 'novelId')(t)
  ]
)

export type NovelChapterRow = typeof novelChapterTable.$inferSelect
export type InsertNovelChapterRow = typeof novelChapterTable.$inferInsert

// Story events; the timeline view is these rows ordered by `orderKey`.
// One table serves both StoryEvent and timeline (PRD §3.1 timeline_events).
export const timelineEventTable = sqliteTable(
  'timeline_event',
  {
    id: uuidPrimaryKeyOrdered(),
    novelId: text()
      .notNull()
      .references(() => novelTable.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    summary: text().notNull().default(''),
    eventType: text().$type<TimelineEventType>().notNull().default('other'),
    /** In-story (diegetic) time as free text, e.g. "春游当日" / "三年前". */
    storyTime: text(),
    location: text(),
    /** Involved entity names (resolved to entities by name in the UI, like relations). */
    participants: text({ mode: 'json' }).$type<string[]>(),
    /** Anchors the event to a chapter; nulled (not deleted) if the chapter is removed. */
    chapterId: text().references(() => novelChapterTable.id, { onDelete: 'set null' }),
    ...orderKeyColumns,
    ...createUpdateTimestamps
  },
  (t) => [
    check('timeline_event_type_check', sql`${t.eventType} IN ('plot', 'turn', 'reveal', 'conflict', 'daily', 'other')`),
    scopedOrderKeyIndex('timeline_event', 'novelId')(t)
  ]
)

export type TimelineEventRow = typeof timelineEventTable.$inferSelect
export type InsertTimelineEventRow = typeof timelineEventTable.$inferInsert

// M10 chat graft: one row per novel chat session. `topicId` is ALSO the id of
// a real `topic` row (`novel-…` prefixed, no FK — the topic table belongs to
// the chat domain); the prefix routes dispatch to NovelChatContextProvider,
// which assembles the ST scaffold from `config` on every send.
export const novelChatSessionTable = sqliteTable('novel_chat_session', {
  topicId: text().primaryKey(),
  novelId: text()
    .notNull()
    .references(() => novelTable.id, { onDelete: 'cascade' }),
  chapterId: text()
    .notNull()
    .references(() => novelChapterTable.id, { onDelete: 'cascade' }),
  /**
   * Dedicated per-novel assistant (name 小说·<title>, empty prompt) shared by
   * the novel's sessions. Gives the embedded chat its full capability toolbar
   * (model/thinking/web/knowledge/@) without touching the user's real
   * assistants. Nullable: rows created before the column exist are backfilled
   * on the next `create()` call. No FK — assistant belongs to the chat domain.
   */
  assistantId: text(),
  config: text({ mode: 'json' }).$type<NovelChatConfig>().notNull(),
  ...createUpdateTimestamps
})

export type NovelChatSessionRow = typeof novelChatSessionTable.$inferSelect
export type InsertNovelChatSessionRow = typeof novelChatSessionTable.$inferInsert
