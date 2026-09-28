/**
 * Shared novel-session assembly: ST assets + chat history → final message
 * array, plus the workbench's context-block formatters (timeline, zero-hit
 * worldbook fallback).
 *
 * Lives in `src/shared` because BOTH sides assemble: the M9 workbench
 * assembles in the renderer before `window.api.novel.complete`, and the M10
 * chat-pipeline graft assembles in the main process inside
 * `NovelChatContextProvider`. One implementation, two callers.
 */

import type { KnowledgeSearchResult } from '../data/types/knowledge'
import type { NovelEntity, NovelReferenceMode, TimelineEvent, WorldbookEntry } from '../data/types/novel'
import type { WebSearchResult } from '../data/types/webSearch'
import {
  assemblePrompt,
  type AssembleResult,
  buildDefaultPreset,
  parseCharacterCard,
  parsePreset,
  type StWorldbookEntry
} from '../stCompat'

/**
 * Internal entity card (camelCase) → standard ST character-card V2 JSON, the
 * shape `parseCharacterCard` expects. Mirrors the main-side export mapping in
 * NovelEntityService so role-play assembly sees the same card a `:st` export
 * would produce.
 */
export function entityToCardJson(entity: NovelEntity): Record<string, unknown> {
  const card = entity.card
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: entity.name,
      description: card.description ?? '',
      personality: card.personality ?? '',
      scenario: card.scenario ?? '',
      first_mes: card.firstMes ?? '',
      mes_example: card.mesExample ?? '',
      creator_notes: card.creatorNotes ?? '',
      tags: card.tags ?? [],
      ...card.extra
    }
  }
}

/**
 * Merge several entity cards into ONE standard ST card for assembly, so the
 * workbench can carry multiple characters without touching the stCompat
 * engine. Text fields become per-character labeled sections; `{{char}}` (the
 * card name) becomes the joined name list. Single-card selections keep the
 * exact {@link entityToCardJson} shape (including `extra` passthrough), which
 * a merged card intentionally drops — per-character extras can't be merged
 * meaningfully.
 */
export function entitiesToCardJson(entities: NovelEntity[]): Record<string, unknown> | undefined {
  if (entities.length === 0) return undefined
  if (entities.length === 1) return entityToCardJson(entities[0])

  const labeled = (pick: (entity: NovelEntity) => string | undefined): string =>
    entities
      .map((entity) => {
        const value = pick(entity)?.trim()
        return value ? `【${entity.name}】\n${value}` : ''
      })
      .filter(Boolean)
      .join('\n\n')

  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: entities.map((entity) => entity.name).join('、'),
      description: labeled((entity) => entity.card.description),
      personality: labeled((entity) => entity.card.personality),
      scenario: labeled((entity) => entity.card.scenario),
      first_mes: entities[0].card.firstMes ?? '',
      mes_example: entities[0].card.mesExample ?? '',
      creator_notes: '',
      tags: []
    }
  }
}

export interface RoleplayChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AssembleSessionInput {
  /** Verbatim ST preset JSON, or undefined to use the built-in default. */
  presetJson?: Record<string, unknown>
  /** Standard ST character card JSON, or undefined for a card-less session. */
  cardJson?: unknown
  /** Worldbook entries from `/worldbooks/:id`, already enabled-filtered upstream. */
  worldbookEntries?: WorldbookEntry[]
  persona?: string
  userName?: string
  /** Which of the preset's prompt_order lists to use (engine defaults to 100001). */
  characterId?: number | string
  history: RoleplayChatMessage[]
}

/** API worldbook entry → engine StWorldbookEntry (field names already align). */
function toStEntry(entry: WorldbookEntry): StWorldbookEntry {
  return {
    uid: entry.uid,
    keys: entry.keys,
    secondaryKeys: entry.secondaryKeys,
    comment: entry.comment,
    content: entry.content,
    enabled: entry.enabled,
    constant: entry.constant,
    selective: entry.selective,
    selectiveLogic: entry.selectiveLogic,
    position: entry.position,
    depth: entry.depth,
    insertionOrder: entry.insertionOrder,
    probability: entry.probability,
    useProbability: entry.useProbability,
    scanDepth: entry.scanDepth,
    caseSensitive: entry.caseSensitive,
    matchWholeWords: entry.matchWholeWords,
    role: entry.role,
    extra: entry.extra
  }
}

export function assembleSession(input: AssembleSessionInput): AssembleResult {
  const preset = input.presetJson ? parsePreset(input.presetJson).data : buildDefaultPreset()
  const card = input.cardJson ? parseCharacterCard(input.cardJson).data : undefined

  return assemblePrompt({
    preset,
    card,
    persona: input.persona,
    userName: input.userName,
    characterId: input.characterId,
    history: input.history,
    worldbookEntries: (input.worldbookEntries ?? []).filter((entry) => entry.enabled).map(toStEntry)
  })
}

// ============================================================================
// Context-block formatters (writing-context system turn)
// ============================================================================

const TIMELINE_TYPE_LABEL: Record<string, string> = {
  plot: '情节',
  turn: '转折',
  reveal: '揭示',
  conflict: '冲突',
  daily: '日常',
  other: '其他'
}

/**
 * Format a novel's timeline events into a prompt block for the workbench's
 * "carry timeline" toggle. Events arrive in orderKey order from
 * `/novels/:novelId/events`; the block is appended to the writing-context
 * system turn (the "tail of the JSON" the user asked for).
 */
export function formatTimelineBlock(events: TimelineEvent[]): string {
  if (events.length === 0) return ''
  const lines = events.map((event, index) => {
    const type = TIMELINE_TYPE_LABEL[event.eventType] ?? event.eventType
    const where = [event.storyTime, event.location].filter(Boolean).join('·')
    const who = event.participants && event.participants.length > 0 ? `（${event.participants.join('、')}）` : ''
    const summary = event.summary ? `：${event.summary}` : ''
    return `${index + 1}. [${type}] ${event.title}${where ? `（${where}）` : ''}${summary}${who}`
  })
  return `【时间轴】\n${lines.join('\n')}`
}

/**
 * Zero-hit worldbook fallback for the workbench: when the ST engine's keyword
 * scan activates nothing (report.activatedWorldInfo is empty) but a worldbook
 * IS selected, its enabled entries are appended verbatim to the writing-context
 * system turn — same "tail of the JSON" treatment as the timeline block — so
 * the worldbook still reaches the model instead of silently dropping out.
 */
export function formatWorldbookBlock(entries: WorldbookEntry[]): string {
  const enabled = entries.filter((entry) => entry.enabled && entry.content.trim())
  if (enabled.length === 0) return ''
  const lines = enabled.map((entry, index) => {
    const label = entry.comment?.trim() || entry.keys.join('、')
    return `${index + 1}. ${label ? `【${label}】` : ''}${entry.content.trim()}`
  })
  return `【世界书】\n${lines.join('\n')}`
}

// ============================================================================
// Knowledge-base "reference mode" (PRD §5) — shared with the M10 main-side
// scaffold assembler. The retrieval pipeline itself lives per-side (renderer:
// `window.api.knowledge.search`; main: `KnowledgeService.search` directly);
// only the pure formatter is shared.
// ============================================================================

/**
 * Per-mode lead-in that reframes how the model should use the retrieved
 * excerpts. Same chunks, different instruction — the heart of the feature.
 */
const REFERENCE_MODE_LEAD_IN: Record<NovelReferenceMode, string> = {
  fact: '以下是相关设定资料，作为事实依据，请据此保持设定一致，不要与之矛盾：',
  style: '以下文段供你参考其叙事风格、节奏与氛围，请借鉴其笔触，但不要复制其内容或情节：',
  imitate: '以下文段供你模仿其句式结构与用词习惯进行书写，请贴近其语感，但不要照搬原句：'
}

const REFERENCE_WEB_LEAD_IN = '以下是来自网络搜索的补充信息，仅在与当前写作相关时参考，并以你自己的话表达：'

export interface ReferenceSources {
  knowledge: KnowledgeSearchResult[]
  web: WebSearchResult[]
}

/**
 * Formats retrieved knowledge chunks (and optional web results) into a single
 * injected text block, led by the mode-specific instruction. Returns an empty
 * string when there is nothing to inject, so callers can append unconditionally.
 */
export function buildReferenceBlock(mode: NovelReferenceMode, sources: ReferenceSources): string {
  const sections: string[] = []

  const knowledge = sources.knowledge.filter((item) => item.pageContent.trim() !== '')
  if (knowledge.length > 0) {
    const excerpts = knowledge.map((item, index) => `[${index + 1}] ${item.pageContent.trim()}`).join('\n\n')
    sections.push(`${REFERENCE_MODE_LEAD_IN[mode]}\n\n${excerpts}`)
  }

  const web = sources.web.filter((item) => item.content.trim() !== '')
  if (web.length > 0) {
    const excerpts = web
      .map((item, index) => {
        const title = item.title.trim()
        const head = title ? `[网${index + 1}] ${title}` : `[网${index + 1}]`
        return `${head}\n${item.content.trim()}`
      })
      .join('\n\n')
    sections.push(`${REFERENCE_WEB_LEAD_IN}\n\n${excerpts}`)
  }

  return sections.join('\n\n')
}
