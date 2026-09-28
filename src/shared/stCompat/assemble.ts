/**
 * Prompt assembly pipeline (PRD §2.2).
 *
 * Turns a preset + character card + persona + worldbook + chat history into
 * the final ordered message sequence, following ST ChatCompletion semantics:
 *
 * - `prompt_order` decides which prompts are enabled and their relative order
 * - marker identifiers are slots filled from the card / persona / world info
 *   at assembly time (this is where the dual-track internal tables plug in)
 * - prompts with `injection_position === 1` and at-depth world info entries
 *   are injected INTO the chat history, `injection_depth` messages from the end
 * - every emitted message carries a `source` tag for the prompt-inspector UI
 */

import { substituteMacros } from './macros'
import type {
  AssembledMessage,
  ChatMessage,
  MacroContext,
  StCharacterCard,
  StPreset,
  StPromptEntry,
  StWarning,
  StWorldbookEntry
} from './types'
import { ST_DEFAULT_CHARACTER_ID, ST_MARKER_IDENTIFIERS } from './types'
import type { WorldInfoOptions } from './worldInfo'
import { matchWorldInfo } from './worldInfo'

export interface AssembleInput {
  preset: StPreset
  card?: StCharacterCard
  /** User persona description (fills the personaDescription slot). */
  persona?: string
  /** Display name of the user ({{user}}). Defaults to 'User'. */
  userName?: string
  /** Override for {{char}}; defaults to the card name. */
  charName?: string
  history: ChatMessage[]
  worldbookEntries?: StWorldbookEntry[]
  worldInfoOptions?: WorldInfoOptions
  /** Which prompt_order to use; defaults to ST's global id (100001). */
  characterId?: number | string
  /** Extra macros merged into the substitution context. */
  extraMacros?: Record<string, string>
}

export interface AssembleReport {
  /** Identifiers included in the final sequence, in order. */
  includedPrompts: Array<{ identifier: string; name: string }>
  skippedPrompts: Array<{ identifier: string; reason: string }>
  /** Activated world info entries (comment or uid). */
  activatedWorldInfo: string[]
  unknownMacros: string[]
}

export interface AssembleResult {
  messages: AssembledMessage[]
  warnings: StWarning[]
  report: AssembleReport
}

interface DepthInjectionItem {
  depth: number
  role: AssembledMessage['role']
  content: string
  order: number
  source: string
}

function applyWiFormat(block: string, wiFormat: string | undefined): string {
  if (!block) return block
  if (!wiFormat || !wiFormat.includes('{0}')) return block
  return wiFormat.replace('{0}', block)
}

export function assemblePrompt(input: AssembleInput): AssembleResult {
  const { preset, card, history } = input
  const warnings: StWarning[] = []
  const unknownMacros = new Set<string>()

  const charName = input.charName ?? card?.data.name ?? ''
  const macroCtx: MacroContext = {
    char: charName,
    user: input.userName ?? 'User',
    description: card?.data.description ?? '',
    personality: card?.data.personality ?? '',
    scenario: card?.data.scenario ?? '',
    persona: input.persona ?? '',
    extra: input.extraMacros
  }

  const substitute = (text: string): string => {
    const result = substituteMacros(text, macroCtx)
    for (const macro of result.unknownMacros) unknownMacros.add(macro)
    return result.text
  }

  // --- World info ---
  const wi = matchWorldInfo(input.worldbookEntries ?? [], history, input.worldInfoOptions)
  const joinWiBlock = (entries: StWorldbookEntry[]): string =>
    applyWiFormat(entries.map((entry) => substitute(entry.content)).join('\n'), preset.wi_format)
  const wiBefore = joinWiBlock(wi.before)
  const wiAfter = joinWiBlock(wi.after)

  // --- Select prompt order ---
  const promptsById = new Map<string, StPromptEntry>(preset.prompts.map((p) => [p.identifier, p]))
  const wantedId = input.characterId ?? ST_DEFAULT_CHARACTER_ID
  const order =
    preset.prompt_order.find((o) => String(o.character_id) === String(wantedId)) ??
    preset.prompt_order.find((o) => String(o.character_id) === String(ST_DEFAULT_CHARACTER_ID)) ??
    preset.prompt_order[0]

  let orderEntries: Array<{ identifier: string; enabled: boolean }>
  if (order) {
    orderEntries = order.order
  } else {
    warnings.push({
      code: 'missing_prompt_order',
      message: '预设缺少 prompt_order，按 prompts 数组顺序全部启用'
    })
    orderEntries = preset.prompts.map((p) => ({ identifier: p.identifier, enabled: true }))
  }

  // --- Pass 1: collect ALL absolute (at-depth) injections first. ST gathers
  // them before building the sequence, so a depth prompt listed AFTER the
  // chatHistory marker still lands inside the history. ---
  const report: AssembleReport = { includedPrompts: [], skippedPrompts: [], activatedWorldInfo: [], unknownMacros: [] }
  const messages: AssembledMessage[] = []
  const depthInjections: DepthInjectionItem[] = wi.depthInjections.map((injection) => ({
    ...injection,
    content: substitute(injection.content)
  }))
  const absoluteIdentifiers = new Set<string>()

  for (const orderEntry of orderEntries) {
    if (!orderEntry.enabled) continue
    const prompt = promptsById.get(orderEntry.identifier)
    if (!prompt || prompt.marker || prompt.injection_position !== 1) continue
    if ((ST_MARKER_IDENTIFIERS as readonly string[]).includes(prompt.identifier)) continue

    absoluteIdentifiers.add(prompt.identifier)
    const content = substitute(prompt.content)
    if (content.trim()) {
      depthInjections.push({
        depth: prompt.injection_depth,
        role: prompt.role,
        content,
        order: prompt.injection_order,
        source: `preset:${prompt.identifier}`
      })
      report.includedPrompts.push({ identifier: prompt.identifier, name: prompt.name })
    } else {
      report.skippedPrompts.push({ identifier: prompt.identifier, reason: 'empty' })
    }
  }

  let chatHistoryEmitted = false

  const pushMessage = (role: AssembledMessage['role'], content: string, source: string, identifier?: string) => {
    if (!content.trim()) {
      if (identifier) report.skippedPrompts.push({ identifier, reason: 'empty' })
      return
    }
    messages.push({ role, content, source })
    if (identifier) {
      report.includedPrompts.push({ identifier, name: promptsById.get(identifier)?.name ?? identifier })
    }
  }

  const emitChatHistory = () => {
    chatHistoryEmitted = true
    const segment: AssembledMessage[] = []

    if (preset.new_chat_prompt) {
      segment.push({ role: 'system', content: substitute(preset.new_chat_prompt), source: 'preset:new_chat_prompt' })
    }
    for (const message of history) {
      segment.push({ ...message, source: 'chatHistory' })
    }

    // Depth injections: depth = messages from the END of history. Insert
    // deepest-first so earlier splices don't shift later indices.
    const historyStart = preset.new_chat_prompt ? 1 : 0
    const sorted = [...depthInjections].sort((a, b) => b.depth - a.depth || a.order - b.order)
    for (const injection of sorted) {
      const index = Math.max(historyStart, segment.length - injection.depth)
      segment.splice(index, 0, {
        role: injection.role,
        content: injection.content,
        source: injection.source
      })
    }

    messages.push(...segment)
  }

  for (const orderEntry of orderEntries) {
    if (!orderEntry.enabled) {
      report.skippedPrompts.push({ identifier: orderEntry.identifier, reason: 'disabled' })
      continue
    }
    const prompt = promptsById.get(orderEntry.identifier)
    if (!prompt) {
      report.skippedPrompts.push({ identifier: orderEntry.identifier, reason: 'not_found' })
      continue
    }

    switch (prompt.identifier) {
      case 'chatHistory':
        emitChatHistory()
        report.includedPrompts.push({ identifier: prompt.identifier, name: prompt.name || 'Chat History' })
        continue
      case 'charDescription':
        pushMessage('system', substitute(card?.data.description ?? ''), 'card:description', prompt.identifier)
        continue
      case 'charPersonality':
        pushMessage('system', substitute(card?.data.personality ?? ''), 'card:personality', prompt.identifier)
        continue
      case 'scenario':
        pushMessage('system', substitute(card?.data.scenario ?? ''), 'card:scenario', prompt.identifier)
        continue
      case 'personaDescription':
        pushMessage('system', substitute(input.persona ?? ''), 'persona', prompt.identifier)
        continue
      case 'worldInfoBefore':
        pushMessage('system', wiBefore, 'worldInfo:before', prompt.identifier)
        continue
      case 'worldInfoAfter':
        pushMessage('system', wiAfter, 'worldInfo:after', prompt.identifier)
        continue
      case 'dialogueExamples':
        // Simplified vs ST (which splits <START> blocks into named messages).
        pushMessage('system', substitute(card?.data.mes_example ?? ''), 'card:mes_example', prompt.identifier)
        continue
      default:
        break
    }

    if (prompt.marker) {
      report.skippedPrompts.push({ identifier: prompt.identifier, reason: 'unsupported_marker' })
      warnings.push({
        code: 'unsupported_marker',
        message: `未知的 marker 条目「${prompt.identifier}」，组装时已跳过`
      })
      continue
    }

    // Absolute prompts were already collected in pass 1.
    if (absoluteIdentifiers.has(prompt.identifier) || prompt.injection_position === 1) {
      continue
    }

    pushMessage(prompt.role, substitute(prompt.content), `preset:${prompt.identifier}`, prompt.identifier)
  }

  if (!chatHistoryEmitted && (history.length > 0 || depthInjections.length > 0)) {
    warnings.push({
      code: 'chat_history_not_emitted',
      message: 'prompt_order 中没有启用 chatHistory 条目，聊天历史与深度注入未进入最终提示词'
    })
  }

  // --- squash_system_messages ---
  let finalMessages = messages
  if (preset.squash_system_messages) {
    finalMessages = []
    for (const message of messages) {
      const previous = finalMessages[finalMessages.length - 1]
      if (previous && previous.role === 'system' && message.role === 'system' && message.source !== 'chatHistory') {
        previous.content = `${previous.content}\n${message.content}`
        previous.source = `${previous.source}+${message.source}`
      } else {
        finalMessages.push({ ...message })
      }
    }
  }

  report.activatedWorldInfo = wi.activated.map((entry) => entry.comment || String(entry.uid ?? 'entry'))
  report.unknownMacros = [...unknownMacros]

  return { messages: finalMessages, warnings, report }
}
