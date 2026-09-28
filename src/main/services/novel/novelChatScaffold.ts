/**
 * M10 chat graft — main-side scaffold assembly.
 *
 * Given a `novel-…` topic's session config and the topic's REAL message
 * history, rebuild the model-facing history the way the M9 workbench does:
 * ST preset / worldbook / character-card scaffolding around the conversation,
 * plus the writing-context system turn (editable header + previous chapters +
 * current chapter body + optional timeline + zero-hit worldbook fallback).
 *
 * The engine assembles from FLATTENED text history (worldbook scanning and
 * marker placement need plain text), then every `chatHistory`-sourced message
 * is substituted 1:1 with the original rich CherryUIMessage, so attachments /
 * reasoning parts survive while depth injections keep their spliced positions.
 */

import { application } from '@application'
import { novelChapterService } from '@data/services/NovelChapterService'
import { novelChatSessionService } from '@data/services/NovelChatSessionService'
import { novelEntityService } from '@data/services/NovelEntityService'
import { novelTimelineService } from '@data/services/NovelTimelineService'
import { stPresetService } from '@data/services/StPresetService'
import { worldbookService } from '@data/services/WorldbookService'
import { loggerService } from '@logger'
import type { KnowledgeSearchResult } from '@shared/data/types/knowledge'
import type { CherryUIMessage } from '@shared/data/types/message'
import { NOVEL_HISTORY_ROUNDS_ALL, type NovelChatSession, type WorldbookEntry } from '@shared/data/types/novel'
import type { WebSearchResult } from '@shared/data/types/webSearch'
import {
  assembleSession,
  buildReferenceBlock,
  entitiesToCardJson,
  formatTimelineBlock,
  formatWorldbookBlock,
  type RoleplayChatMessage
} from '@shared/novel/assembly'

const logger = loggerService.withContext('NovelChatScaffold')

/** Mirrors the renderer's `novels.write.system_prompt` default (main has no i18n). */
export const DEFAULT_NOVEL_SYSTEM_PROMPT =
  '你是一位资深小说写作助手，请根据用户的指令进行续写、润色或与用户讨论剧情。保持文风连贯，直接输出正文，不要解释。'

export interface NovelScaffoldResult {
  messages: CherryUIMessage[]
  stats: { included: number; world: number; worldTotal: number }
  warnings: string[]
}

function textOf(message: CherryUIMessage): string {
  return message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
}

function syntheticMessage(index: number | string, role: CherryUIMessage['role'], content: string): CherryUIMessage {
  return {
    id: `novel-scaffold-${index}`,
    role,
    parts: [{ type: 'text', text: content }]
  }
}

function isChatHistorySource(source: string): boolean {
  // squash_system_messages may append a merged source suffix.
  return source === 'chatHistory' || source.startsWith('chatHistory+')
}

/**
 * Trim to the trailing N user/assistant TURNS (pairs), matching the M9
 * workbench's ROUNDS_ALL / rounds semantics — applied to the flattened text
 * history AND the real message array in lockstep (same slice length) so
 * indices stay aligned for the chatHistory substitution pass.
 */
function applyHistoryRounds<T>(history: T[], rounds: number): T[] {
  if (rounds === NOVEL_HISTORY_ROUNDS_ALL) return history
  if (rounds <= 0) return []
  return history.slice(-rounds * 2)
}

/**
 * Main-side knowledge-base + web-search retrieval for the reference-mode
 * feature — mirrors the renderer's `retrieveReferences` but calls the
 * services directly (no IPC round-trip; this already runs in main). Each
 * side fails soft: a retrieval error yields an empty list, matching the
 * renderer wrapper's contract.
 */
async function retrieveReferencesMain(
  knowledgeBaseId: string | undefined,
  webSearchEnabled: boolean,
  query: string
): Promise<{ knowledge: KnowledgeSearchResult[]; web: WebSearchResult[] }> {
  const trimmed = query.trim()
  if (trimmed === '') return { knowledge: [], web: [] }

  const knowledgePromise: Promise<KnowledgeSearchResult[]> = knowledgeBaseId
    ? application
        .get('KnowledgeService')
        .search(knowledgeBaseId, trimmed)
        .catch((error: unknown) => {
          logger.warn('Knowledge search failed', error as Error)
          return []
        })
    : Promise.resolve([])

  const webPromise: Promise<WebSearchResult[]> = webSearchEnabled
    ? application
        .get('WebSearchService')
        .searchKeywords({ keywords: [trimmed] })
        .then((response) => response.results)
        .catch((error: unknown) => {
          logger.warn('Web search failed', error as Error)
          return []
        })
    : Promise.resolve([])

  const [knowledge, web] = await Promise.all([knowledgePromise, webPromise])
  return { knowledge, web }
}

/**
 * ST assembly scatters system messages throughout the sequence (depth
 * injections, writing context spliced before the last user turn) — valid ST
 * semantics, but Gemini and some Claude-compatible gateways reject any system
 * message that isn't at the very start ('system messages are only supported
 * at the beginning of the conversation'). Fix: merge every system message's
 * text into ONE leading system turn, preserving the rest of the sequence's
 * relative order untouched. User's confirmed choice over provider-conditional
 * merging or converting mid-stream system entries to user role.
 */
function mergeSystemMessagesToFront(messages: CherryUIMessage[]): CherryUIMessage[] {
  const systemTexts: string[] = []
  const rest: CherryUIMessage[] = []
  for (const message of messages) {
    if (message.role === 'system') {
      const text = textOf(message).trim()
      if (text) systemTexts.push(text)
    } else {
      rest.push(message)
    }
  }
  if (systemTexts.length === 0) return rest
  return [syntheticMessage('merged-system', 'system', systemTexts.join('\n\n')), ...rest]
}

/** Writing-context system turn — same construction as the M9 workbench. */
async function buildWritingContext(
  session: NovelChatSession,
  worldbookEntries: WorldbookEntry[] | undefined,
  worldbookActivated: number,
  /** The instruction being answered — the reference-mode retrieval query. */
  queryText: string
): Promise<string> {
  const config = session.config
  let system = config.systemPrompt?.trim() || DEFAULT_NOVEL_SYSTEM_PROMPT

  const chapters = await novelChapterService.list(session.novelId)
  const index = chapters.findIndex((chapter) => chapter.id === session.chapterId)

  if (config.prevChapterCount > 0 && index > 0) {
    const previous = chapters.slice(Math.max(0, index - config.prevChapterCount), index)
    const bodies: string[] = []
    for (const meta of previous) {
      const full = await novelChapterService.getById(session.novelId, meta.id)
      if (full.content.trim()) bodies.push(`《${full.title}》\n${full.content}`)
    }
    if (bodies.length > 0) system = `${system}\n\n【前情章节】\n${bodies.join('\n\n')}`
  }

  if (index >= 0) {
    const current = await novelChapterService.getById(session.novelId, session.chapterId)
    if (current.content.trim()) system = `${system}\n\n【当前章节正文】\n${current.content}`
  }

  if (config.carryTimeline) {
    const events = await novelTimelineService.list(session.novelId)
    const timelineBlock = formatTimelineBlock(events)
    if (timelineBlock) system = `${system}\n\n${timelineBlock}`
  }

  // Zero-hit worldbook fallback — mirror of the M9 workbench rule.
  if (worldbookEntries && worldbookEntries.length > 0 && worldbookActivated === 0) {
    const fallback = formatWorldbookBlock(worldbookEntries)
    if (fallback) system = `${system}\n\n${fallback}`
  }

  // Knowledge-base reference mode + parallel web search (mirrors M9's
  // novelReference.ts wiring in the workbench).
  if (config.knowledgeBaseId || config.webSearchEnabled) {
    const sources = await retrieveReferencesMain(config.knowledgeBaseId, config.webSearchEnabled, queryText)
    const referenceBlock = buildReferenceBlock(config.referenceMode, sources)
    if (referenceBlock) system = `${system}\n\n${referenceBlock}`
  }

  return system
}

/**
 * Assemble the model-facing history for one send. `realHistory` is the
 * root→anchor message path (its last element is the user turn being answered).
 * Returns `realHistory` untouched when the topic has no session row or the
 * config selects nothing — and NEVER throws: a scaffold failure must not brick
 * the send, so errors degrade to the raw history with a logged warning.
 */
export async function buildNovelScaffoldHistory(
  topicId: string,
  realHistory: CherryUIMessage[]
): Promise<NovelScaffoldResult> {
  try {
    return await assembleScaffold(topicId, realHistory)
  } catch (error) {
    logger.error('Scaffold assembly failed — sending raw history', error as Error)
    return {
      messages: realHistory,
      stats: { included: 0, world: 0, worldTotal: 0 },
      warnings: [`组装失败，已按原始消息发送：${(error as Error).message}`]
    }
  }
}

async function assembleScaffold(topicId: string, realHistory: CherryUIMessage[]): Promise<NovelScaffoldResult> {
  const session = await novelChatSessionService.getByTopicId(topicId)
  if (!session) {
    return { messages: realHistory, stats: { included: 0, world: 0, worldTotal: 0 }, warnings: [] }
  }
  const config = session.config
  const warnings: string[] = []

  // --- Load selected assets (a deleted asset degrades with a warning) ---
  let presetJson: Record<string, unknown> | undefined
  if (config.presetId) {
    try {
      presetJson = (await stPresetService.getById(config.presetId)).json
    } catch {
      warnings.push('预设不存在（可能已删除），本次未使用')
    }
  }
  let worldbookEntries: WorldbookEntry[] | undefined
  if (config.worldbookId) {
    try {
      worldbookEntries = (await worldbookService.getById(config.worldbookId)).entries
    } catch {
      warnings.push('世界书不存在（可能已删除），本次未使用')
    }
  }
  const entities =
    config.entityIds.length > 0
      ? (await novelEntityService.list(session.novelId)).filter((entity) => config.entityIds.includes(entity.id))
      : []

  // --- History-rounds trim (M9 ROUNDS_ALL semantics), applied BEFORE
  // flattening so the engine and the substitution pass see the same window. ---
  const trimmedHistory = applyHistoryRounds(realHistory, config.historyRounds)
  const queryText = textOf(trimmedHistory.at(-1) ?? realHistory.at(-1) ?? syntheticMessage(0, 'user', ''))

  // --- Flatten real history for the engine (1:1 index mapping) ---
  const textHistory: RoleplayChatMessage[] = trimmedHistory.map((message) => ({
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: textOf(message)
  }))

  const useStAssets = presetJson !== undefined || worldbookEntries !== undefined || entities.length > 0

  if (!useStAssets) {
    // No ST assets: plain [writing-context, ...history] like the M9 non-ST branch.
    const system = await buildWritingContext(session, undefined, 0, queryText)
    const messages = mergeSystemMessagesToFront([syntheticMessage(0, 'system', system), ...trimmedHistory])
    return { messages, stats: { included: 0, world: 0, worldTotal: 0 }, warnings }
  }

  const assembled = assembleSession({
    presetJson,
    cardJson: entitiesToCardJson(entities),
    worldbookEntries,
    characterId: config.orderCharacterId,
    history: textHistory
  })
  for (const warning of assembled.warnings) warnings.push(warning.message)

  // Writing context must reflect the actual worldbook activation count.
  const worldHits = assembled.report.activatedWorldInfo.length
  const contextBlock = await buildWritingContext(session, worldbookEntries, worldHits, queryText)

  // --- Substitute real messages back into the assembled sequence ---
  const messages: CherryUIMessage[] = []
  let historyIndex = 0
  let lastRealIndex = -1
  for (let i = 0; i < assembled.messages.length; i++) {
    const item = assembled.messages[i]
    if (isChatHistorySource(item.source) && historyIndex < trimmedHistory.length) {
      messages.push(trimmedHistory[historyIndex])
      historyIndex += 1
      lastRealIndex = messages.length - 1
    } else {
      messages.push(syntheticMessage(i, item.role, item.content))
    }
  }

  // Post-history injections (ST semantics): preset entries emitted AFTER the
  // final real user turn tend to override its intent — the X-preset "ignores
  // my input" report was exactly this. Surface it so the user can decide.
  const postHistoryCount = lastRealIndex >= 0 ? messages.length - 1 - lastRealIndex : 0
  if (postHistoryCount > 0) {
    warnings.push(
      `预设在聊天历史之后注入了 ${postHistoryCount} 条后置条目：模型会优先执行其中的指令，可能盖过你的最新输入。想正常问答可在「预设条目开关」里关闭它们。`
    )
  }

  // Writing context rides as an extra system turn right before the final user
  // message (the turn being answered) — same as the M9 workbench splice.
  let lastUserIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserIndex = i
      break
    }
  }
  const contextMessage = syntheticMessage(assembled.messages.length, 'system', contextBlock)
  if (lastUserIndex >= 0) {
    messages.splice(lastUserIndex, 0, contextMessage)
  } else {
    messages.push(contextMessage)
  }

  if (messages.at(-1)?.role === 'assistant') {
    warnings.push('最后一条消息是 assistant 角色：模型将从它继续续写，而不是回答输入')
  }

  // Merge scattered system turns (depth injections + the spliced writing
  // context) into one leading system message — ST semantics allow system
  // anywhere, but Gemini and some Claude-compatible gateways reject that.
  // Merging drops non-system messages' relative order not at all — only
  // system entries are pulled out — so the trailing-role check above sees
  // the same tail either way.
  const finalMessages = mergeSystemMessagesToFront(messages)

  return {
    messages: finalMessages,
    stats: {
      included: assembled.report.includedPrompts.length,
      world: worldHits,
      worldTotal: worldbookEntries?.length ?? 0
    },
    warnings
  }
}

/** Dry-run for the workbench preview dialog — same code path as a real send. */
export async function previewNovelScaffold(
  topicId: string,
  realHistory: CherryUIMessage[]
): Promise<{
  messages: Array<{ role: string; source: string; content: string }>
  stats: NovelScaffoldResult['stats']
  warnings: string[]
}> {
  const result = await buildNovelScaffoldHistory(topicId, realHistory)
  return {
    messages: result.messages.map((message) => ({
      role: message.role,
      source: message.id.startsWith('novel-scaffold-') ? 'scaffold' : 'chatHistory',
      content: textOf(message)
    })),
    stats: result.stats,
    warnings: result.warnings
  }
}
