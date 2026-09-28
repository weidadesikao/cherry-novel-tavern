/**
 * ST preset parsing.
 *
 * Validates the raw JSON leniently and reports — rather than rejects —
 * behavior flags the engine does not implement yet (PRD risk #1: unsupported
 * fields must be surfaced, never silently ignored).
 */

import type { ParseResult, StPreset, StWarning } from './types'
import { StPresetSchema } from './types'

/** Behavior flags whose effects the engine does not implement yet. */
const UNSUPPORTED_BEHAVIOR_FLAGS: Array<{ field: string; isActive: (value: unknown) => boolean }> = [
  { field: 'wrap_in_quotes', isActive: (v) => v === true },
  { field: 'continue_prefill', isActive: (v) => v === true },
  { field: 'image_inlining', isActive: (v) => v === true },
  { field: 'video_inlining', isActive: (v) => v === true },
  { field: 'function_calling', isActive: (v) => v === true },
  { field: 'enable_web_search', isActive: (v) => v === true },
  { field: 'assistant_prefill', isActive: (v) => typeof v === 'string' && v.length > 0 },
  { field: 'bias_preset_selected', isActive: (v) => typeof v === 'string' && v.length > 0 }
]

export function parsePreset(json: unknown): ParseResult<StPreset> {
  const preset = StPresetSchema.parse(json)
  const warnings: StWarning[] = []

  const raw = json as Record<string, unknown>
  for (const { field, isActive } of UNSUPPORTED_BEHAVIOR_FLAGS) {
    if (isActive(raw?.[field])) {
      warnings.push({
        code: 'unsupported_preset_field',
        message: `预设字段「${field}」当前引擎未实现，导入后该行为不会生效`
      })
    }
  }

  // Order entries referencing prompts that do not exist break assembly — flag them.
  const knownIdentifiers = new Set(preset.prompts.map((p) => p.identifier))
  for (const order of preset.prompt_order) {
    for (const entry of order.order) {
      if (!knownIdentifiers.has(entry.identifier)) {
        warnings.push({
          code: 'unknown_order_identifier',
          message: `prompt_order 引用了不存在的条目「${entry.identifier}」（character_id=${order.character_id}），组装时将跳过`
        })
      }
    }
  }

  return { data: preset, warnings }
}

/** Sampling parameters mapped to Cherry Studio's model-call options. */
export interface PresetSamplingParams {
  temperature?: number
  topP?: number
  frequencyPenalty?: number
  presencePenalty?: number
  maxTokens?: number
  maxContext?: number
}

export function extractSamplingParams(preset: StPreset): PresetSamplingParams {
  return {
    temperature: preset.temperature,
    topP: preset.top_p,
    frequencyPenalty: preset.frequency_penalty,
    presencePenalty: preset.presence_penalty,
    maxTokens: preset.openai_max_tokens,
    maxContext: preset.openai_max_context
  }
}
