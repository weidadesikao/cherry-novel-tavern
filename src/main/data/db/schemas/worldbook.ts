import type { WorldbookSource } from '@shared/data/types/novel'
import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey, uuidPrimaryKeyOrdered } from './_columnHelpers'

export const worldbookTable = sqliteTable(
  'worldbook',
  {
    id: uuidPrimaryKey(),
    name: text().notNull(),
    description: text(),
    source: text().$type<WorldbookSource>().notNull(),
    ...createUpdateTimestamps
  },
  (t) => [check('worldbook_source_check', sql`${t.source} IN ('imported', 'created')`)]
)

export type WorldbookRow = typeof worldbookTable.$inferSelect
export type InsertWorldbookRow = typeof worldbookTable.$inferInsert

// Field set mirrors the engine's StWorldbookEntry; ST fields the engine does
// not model are preserved verbatim in `extra` so exports stay lossless.
export const worldbookEntryTable = sqliteTable(
  'worldbook_entry',
  {
    id: uuidPrimaryKeyOrdered(),
    worldbookId: text()
      .notNull()
      .references(() => worldbookTable.id, { onDelete: 'cascade' }),
    uid: integer(),
    keys: text({ mode: 'json' }).$type<string[]>().notNull(),
    secondaryKeys: text({ mode: 'json' }).$type<string[]>(),
    comment: text(),
    content: text().notNull().default(''),
    enabled: integer({ mode: 'boolean' }).notNull().default(true),
    constant: integer({ mode: 'boolean' }).notNull().default(false),
    selective: integer({ mode: 'boolean' }).notNull().default(false),
    selectiveLogic: integer(),
    position: integer(),
    depth: integer(),
    insertionOrder: integer().notNull().default(100),
    probability: integer(),
    useProbability: integer({ mode: 'boolean' }),
    scanDepth: integer(),
    caseSensitive: integer({ mode: 'boolean' }),
    matchWholeWords: integer({ mode: 'boolean' }),
    role: text().$type<'system' | 'user' | 'assistant'>(),
    extra: text({ mode: 'json' }).$type<Record<string, unknown>>(),
    ...createUpdateTimestamps
  },
  (t) => [index('worldbook_entry_worldbook_idx').on(t.worldbookId)]
)

export type WorldbookEntryRow = typeof worldbookEntryTable.$inferSelect
export type InsertWorldbookEntryRow = typeof worldbookEntryTable.$inferInsert
