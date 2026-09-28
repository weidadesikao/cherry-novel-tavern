/**
 * Novel Chat Session Service — the M10 chat graft's config store.
 *
 * A session binds a real chat topic (id `novel-<uuid>`) to a chapter and
 * carries the workbench's ST-asset selections. The topic row is created here
 * (same direct-insert pattern TemporaryChatService.persist uses) so the topic
 * and the session row commit in one transaction; the `novel-` prefix routes
 * `Ai_Stream_Open` dispatch to NovelChatContextProvider, which reads `config`
 * back on every send.
 */

import { application } from '@application'
import { novelChapterTable, type NovelChatSessionRow, novelChatSessionTable, novelTable } from '@data/db/schemas/novel'
import { topicTable } from '@data/db/schemas/topic'
import { assistantDataService } from '@data/services/AssistantService'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { NovelChatConfig, NovelChatSession } from '@shared/data/types/novel'
import { NOVEL_TOPIC_PREFIX, NovelChatConfigSchema } from '@shared/data/types/novel'
import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

import { insertWithOrderKey } from './utils/orderKey'
import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:NovelChatSessionService')

function rowToSession(row: NovelChatSessionRow): NovelChatSession {
  return {
    topicId: row.topicId,
    novelId: row.novelId,
    chapterId: row.chapterId,
    assistantId: row.assistantId ?? undefined,
    // Parse on the way out so config rows written by older builds pick up new
    // defaults instead of failing the strict response shape.
    config: NovelChatConfigSchema.parse(row.config),
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

export class NovelChatSessionService {
  private get dbService() {
    return application.get('DbService')
  }

  private get db() {
    return this.dbService.getDb()
  }

  async getByChapter(novelId: string, chapterId: string): Promise<NovelChatSession | null> {
    const [row] = await this.db
      .select()
      .from(novelChatSessionTable)
      .where(and(eq(novelChatSessionTable.novelId, novelId), eq(novelChatSessionTable.chapterId, chapterId)))
      .limit(1)
    return row ? rowToSession(row) : null
  }

  async getByTopicId(topicId: string): Promise<NovelChatSession | null> {
    const [row] = await this.db
      .select()
      .from(novelChatSessionTable)
      .where(eq(novelChatSessionTable.topicId, topicId))
      .limit(1)
    return row ? rowToSession(row) : null
  }

  /**
   * The novel's dedicated assistant (shared by all its chapter sessions):
   * reuse a sibling session's, else create `小说·<title>` with an empty
   * prompt — the ST scaffold IS the prompt; the assistant row only carries
   * model + capability settings for the embedded chat toolbar.
   */
  private async resolveNovelAssistantId(novelId: string, novelTitle: string): Promise<string> {
    const [sibling] = await this.db
      .select({ assistantId: novelChatSessionTable.assistantId })
      .from(novelChatSessionTable)
      .where(and(eq(novelChatSessionTable.novelId, novelId), isNotNull(novelChatSessionTable.assistantId)))
      .limit(1)
    if (sibling?.assistantId) return sibling.assistantId

    const assistant = await assistantDataService.create({ name: `小说·${novelTitle}`, emoji: '📖' })
    logger.info('Created dedicated novel assistant', { novelId, assistantId: assistant.id })
    return assistant.id
  }

  /**
   * Backfill for sessions created before the assistant column existed: attach
   * the novel's dedicated assistant to both the session row and the topic row
   * (overwriting whatever the topic carried — e.g. the default assistant).
   */
  private async attachAssistant(session: NovelChatSession): Promise<NovelChatSession> {
    const [novel] = await this.db
      .select({ title: novelTable.title })
      .from(novelTable)
      .where(eq(novelTable.id, session.novelId))
      .limit(1)
    const assistantId = await this.resolveNovelAssistantId(session.novelId, novel?.title ?? '未命名')

    const row = await this.dbService.withWriteTx(async (tx) => {
      await tx.update(topicTable).set({ assistantId }).where(eq(topicTable.id, session.topicId))
      const [updated] = await tx
        .update(novelChatSessionTable)
        .set({ assistantId })
        .where(eq(novelChatSessionTable.topicId, session.topicId))
        .returning()
      return updated
    })
    logger.info('Backfilled novel session assistant', { topicId: session.topicId, assistantId })
    return rowToSession(row)
  }

  /**
   * Create the chapter's chat session: one `novel-…` topic row + one session
   * row in a single transaction, bound to the novel's dedicated assistant.
   * Idempotent per chapter — an existing session is returned (with the
   * assistant backfilled if it predates the column) so double-clicks /
   * remounts can't fork the chat.
   */
  async create(novelId: string, chapterId: string): Promise<NovelChatSession> {
    const existing = await this.getByChapter(novelId, chapterId)
    if (existing) {
      return existing.assistantId ? existing : await this.attachAssistant(existing)
    }

    const [chapter] = await this.db
      .select({ title: novelChapterTable.title, novelId: novelChapterTable.novelId })
      .from(novelChapterTable)
      .where(and(eq(novelChapterTable.id, chapterId), eq(novelChapterTable.novelId, novelId)))
      .limit(1)
    if (!chapter) {
      throw DataApiErrorFactory.notFound('Chapter', chapterId)
    }
    const [novel] = await this.db
      .select({ title: novelTable.title })
      .from(novelTable)
      .where(eq(novelTable.id, novelId))
      .limit(1)
    if (!novel) {
      throw DataApiErrorFactory.notFound('Novel', novelId)
    }

    const assistantId = await this.resolveNovelAssistantId(novelId, novel.title)
    const topicId = `${NOVEL_TOPIC_PREFIX}${uuidv4()}`
    const config = NovelChatConfigSchema.parse({})

    const row = await this.dbService.withWriteTx(async (tx) => {
      await insertWithOrderKey(
        tx,
        topicTable,
        {
          id: topicId,
          name: `${novel.title}·${chapter.title}`,
          assistantId,
          isNameManuallyEdited: true
        },
        { pkColumn: topicTable.id, scope: isNull(topicTable.groupId) }
      )
      const [inserted] = await tx
        .insert(novelChatSessionTable)
        .values({ topicId, novelId, chapterId, assistantId, config })
        .returning()
      return inserted
    })

    logger.info('Created novel chat session', { novelId, chapterId, topicId, assistantId })
    return rowToSession(row)
  }

  async updateConfig(novelId: string, topicId: string, config: NovelChatConfig): Promise<NovelChatSession> {
    const row = await this.dbService.withWriteTx(async (tx) => {
      const [updated] = await tx
        .update(novelChatSessionTable)
        .set({ config })
        .where(and(eq(novelChatSessionTable.topicId, topicId), eq(novelChatSessionTable.novelId, novelId)))
        .returning()
      if (!updated) {
        throw DataApiErrorFactory.notFound('NovelChatSession', topicId)
      }
      return updated
    })
    return rowToSession(row)
  }
}

export const novelChatSessionService = new NovelChatSessionService()
