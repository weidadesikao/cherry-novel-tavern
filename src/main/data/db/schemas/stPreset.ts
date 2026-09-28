import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'

// External-table half of the dual-track rule: the verbatim ST preset JSON as
// imported. The prompt-assembly engine parses it at runtime; it is never
// mutated after import.
export const stPresetTable = sqliteTable('st_preset', {
  id: uuidPrimaryKey(),
  name: text().notNull(),
  json: text({ mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  ...createUpdateTimestamps
})

export type StPresetRow = typeof stPresetTable.$inferSelect
export type InsertStPresetRow = typeof stPresetTable.$inferInsert
