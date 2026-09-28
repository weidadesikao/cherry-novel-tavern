/**
 * SillyTavern-compatible asset types
 *
 * Native re-implementation of the ST prompt-assembly data model (PRD §2).
 * Parsing is deliberately lenient: unknown fields are preserved verbatim in
 * `extra` / loose objects so that re-exported files stay lossless (dual-track
 * rule), and unsupported features surface as warnings instead of errors.
 */

import * as z from 'zod'

// ============================================================================
// Preset (prompts + prompt_order)
// ============================================================================

export const StPromptRoleSchema = z.enum(['system', 'user', 'assistant'])
export type StPromptRole = z.infer<typeof StPromptRoleSchema>

/**
 * One entry of the preset `prompts` array. Marker entries (chatHistory,
 * charDescription, …) carry no own content and act as slots filled at
 * assembly time.
 */
export const StPromptEntrySchema = z.looseObject({
  identifier: z.string(),
  name: z.string().default(''),
  role: StPromptRoleSchema.default('system'),
  content: z.string().default(''),
  system_prompt: z.boolean().default(false),
  marker: z.boolean().default(false),
  /** 0 = relative (in-order), 1 = absolute (inject into chat history at depth) */
  injection_position: z.number().int().default(0),
  injection_depth: z.number().int().min(0).default(4),
  injection_order: z.number().int().default(100),
  forbid_overrides: z.boolean().default(false)
})
export type StPromptEntry = z.infer<typeof StPromptEntrySchema>

export const StPromptOrderEntrySchema = z.looseObject({
  identifier: z.string(),
  enabled: z.boolean().default(true)
})
export type StPromptOrderEntry = z.infer<typeof StPromptOrderEntrySchema>

export const StPromptOrderSchema = z.looseObject({
  character_id: z.union([z.number(), z.string()]),
  order: z.array(StPromptOrderEntrySchema).default([])
})
export type StPromptOrder = z.infer<typeof StPromptOrderSchema>

/** ST's pseudo character id whose order applies to all chats by default. */
export const ST_DEFAULT_CHARACTER_ID = 100001

export const StPresetSchema = z.looseObject({
  prompts: z.array(StPromptEntrySchema).default([]),
  prompt_order: z.array(StPromptOrderSchema).default([]),

  temperature: z.number().optional(),
  top_p: z.number().optional(),
  top_k: z.number().optional(),
  frequency_penalty: z.number().optional(),
  presence_penalty: z.number().optional(),
  repetition_penalty: z.number().optional(),
  openai_max_context: z.number().optional(),
  openai_max_tokens: z.number().optional(),

  squash_system_messages: z.boolean().default(false),
  wrap_in_quotes: z.boolean().default(false),
  wi_format: z.string().optional(),
  scenario_format: z.string().optional(),
  personality_format: z.string().optional(),
  continue_prefill: z.boolean().optional(),
  continue_nudge_prompt: z.string().optional(),
  new_chat_prompt: z.string().optional(),
  impersonation_prompt: z.string().optional()
})
export type StPreset = z.infer<typeof StPresetSchema>

/** Marker identifiers the assembly pipeline knows how to fill. */
export const ST_MARKER_IDENTIFIERS = [
  'chatHistory',
  'charDescription',
  'charPersonality',
  'scenario',
  'personaDescription',
  'worldInfoBefore',
  'worldInfoAfter',
  'dialogueExamples'
] as const
export type StMarkerIdentifier = (typeof ST_MARKER_IDENTIFIERS)[number]

// ============================================================================
// Character Card (spec v2; v3 files parse through the same lenient shape)
// ============================================================================

export const StCharacterCardDataSchema = z.looseObject({
  name: z.string().default(''),
  description: z.string().default(''),
  personality: z.string().default(''),
  scenario: z.string().default(''),
  first_mes: z.string().default(''),
  mes_example: z.string().default(''),
  creator_notes: z.string().default(''),
  system_prompt: z.string().default(''),
  post_history_instructions: z.string().default(''),
  alternate_greetings: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  creator: z.string().default(''),
  character_version: z.string().default(''),
  /** Embedded character book — parsed separately via worldbook helpers. */
  character_book: z.unknown().optional()
})
export type StCharacterCardData = z.infer<typeof StCharacterCardDataSchema>

export const StCharacterCardSchema = z.looseObject({
  spec: z.string().default('chara_card_v2'),
  spec_version: z.string().default('2.0'),
  data: StCharacterCardDataSchema
})
export type StCharacterCard = z.infer<typeof StCharacterCardSchema>

// ============================================================================
// Worldbook (World Info)
// ============================================================================

/** ST world_info_logic values. */
export const ST_SELECTIVE_LOGIC = {
  AND_ANY: 0,
  NOT_ALL: 1,
  NOT_ANY: 2,
  AND_ALL: 3
} as const
export type StSelectiveLogic = (typeof ST_SELECTIVE_LOGIC)[keyof typeof ST_SELECTIVE_LOGIC]

/** ST world_info_position values. */
export const ST_WI_POSITION = {
  BEFORE_CHAR: 0,
  AFTER_CHAR: 1,
  AN_TOP: 2,
  AN_BOTTOM: 3,
  AT_DEPTH: 4,
  EM_TOP: 5,
  EM_BOTTOM: 6
} as const
export type StWiPosition = (typeof ST_WI_POSITION)[keyof typeof ST_WI_POSITION]

/**
 * Internal (normalized) worldbook entry. Field names align with the
 * `worldbook_entry` DB table; `extra` keeps every ST field we do not model
 * so exports stay lossless.
 */
export interface StWorldbookEntry {
  uid?: number
  keys: string[]
  secondaryKeys?: string[]
  comment?: string
  content: string
  enabled: boolean
  constant: boolean
  selective: boolean
  selectiveLogic?: number
  position?: number
  depth?: number
  insertionOrder: number
  probability?: number
  useProbability?: boolean
  scanDepth?: number
  caseSensitive?: boolean
  matchWholeWords?: boolean
  role?: StPromptRole
  extra?: Record<string, unknown>
}

/** Raw ST world info file: `{ entries: { "<uid>": {...} } }`. */
export const StWorldbookFileEntrySchema = z.looseObject({
  uid: z.number().optional(),
  key: z.array(z.string()).default([]),
  keysecondary: z.array(z.string()).default([]),
  comment: z.string().default(''),
  content: z.string().default(''),
  constant: z.boolean().default(false),
  selective: z.boolean().default(false),
  selectiveLogic: z.number().int().default(ST_SELECTIVE_LOGIC.AND_ANY),
  order: z.number().default(100),
  position: z.number().int().default(ST_WI_POSITION.BEFORE_CHAR),
  depth: z.number().int().optional(),
  disable: z.boolean().default(false),
  probability: z.number().default(100),
  useProbability: z.boolean().default(false),
  scanDepth: z.number().int().nullish(),
  caseSensitive: z.boolean().nullish(),
  matchWholeWords: z.boolean().nullish(),
  role: z.number().int().nullish()
})
export type StWorldbookFileEntry = z.infer<typeof StWorldbookFileEntrySchema>

export const StWorldbookFileSchema = z.looseObject({
  entries: z.record(z.string(), StWorldbookFileEntrySchema).default({})
})
export type StWorldbookFile = z.infer<typeof StWorldbookFileSchema>

// ============================================================================
// Assembly
// ============================================================================

export interface ChatMessage {
  role: StPromptRole
  content: string
}

export interface AssembledMessage extends ChatMessage {
  /** Where this message came from — drives the prompt-inspector UI (M4). */
  source: string
}

/** Context for {{macro}} substitution. */
export interface MacroContext {
  char?: string
  user?: string
  description?: string
  personality?: string
  scenario?: string
  persona?: string
  /** Extension point: extra macros (name → value). */
  extra?: Record<string, string>
}

export interface StWarning {
  code: string
  message: string
}

export interface ParseResult<T> {
  data: T
  warnings: StWarning[]
}
