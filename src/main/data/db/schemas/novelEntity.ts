import type { NovelEntityCard, NovelEntityType } from '@shared/data/types/novel'
import { sql } from 'drizzle-orm'
import { check, index, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'
import { novelTable } from './novel'

// Internal-table half of the dual-track rule: AI/user edits land here;
// imported ST JSON files are never touched.
export const novelEntityTable = sqliteTable(
  'novel_entity',
  {
    id: uuidPrimaryKey(),
    novelId: text()
      .notNull()
      .references(() => novelTable.id, { onDelete: 'cascade' }),
    type: text().$type<NovelEntityType>().notNull(),
    name: text().notNull(),
    card: text({ mode: 'json' }).$type<NovelEntityCard>().notNull(),
    ...createUpdateTimestamps
  },
  (t) => [
    check('novel_entity_type_check', sql`${t.type} IN ('character', 'location', 'item', 'organization', 'other')`),
    index('novel_entity_novel_type_idx').on(t.novelId, t.type)
  ]
)

export type NovelEntityRow = typeof novelEntityTable.$inferSelect
export type InsertNovelEntityRow = typeof novelEntityTable.$inferInsert

// Directed edges driving the relationship graph view.
export const novelEntityRelationTable = sqliteTable(
  'novel_entity_relation',
  {
    id: uuidPrimaryKey(),
    novelId: text()
      .notNull()
      .references(() => novelTable.id, { onDelete: 'cascade' }),
    fromEntityId: text()
      .notNull()
      .references(() => novelEntityTable.id, { onDelete: 'cascade' }),
    toEntityId: text()
      .notNull()
      .references(() => novelEntityTable.id, { onDelete: 'cascade' }),
    relationType: text().notNull(),
    description: text(),
    ...createUpdateTimestamps
  },
  (t) => [index('novel_entity_relation_novel_idx').on(t.novelId)]
)

export type NovelEntityRelationRow = typeof novelEntityRelationTable.$inferSelect
export type InsertNovelEntityRelationRow = typeof novelEntityRelationTable.$inferInsert
