/**
 * Built-in default preset for role-play / writing sessions when the user has
 * not imported a SillyTavern preset.
 *
 * It wires the standard marker slots in ST's conventional order so the
 * character card, persona and world info fill in, followed by chat history.
 * Markers carry no own content — the assembly pipeline fills them from the
 * dual-track internal tables (PRD §2.2).
 */

import type { StPreset } from './types'
import { ST_DEFAULT_CHARACTER_ID } from './types'

const MARKER_ORDER = [
  'charDescription',
  'charPersonality',
  'scenario',
  'personaDescription',
  'worldInfoBefore',
  'dialogueExamples',
  'chatHistory',
  'worldInfoAfter'
] as const

export function buildDefaultPreset(): StPreset {
  return {
    prompts: MARKER_ORDER.map((identifier) => ({
      identifier,
      name: identifier,
      role: 'system',
      content: '',
      system_prompt: false,
      marker: true,
      injection_position: 0,
      injection_depth: 4,
      injection_order: 100,
      forbid_overrides: false
    })),
    prompt_order: [
      {
        character_id: ST_DEFAULT_CHARACTER_ID,
        order: MARKER_ORDER.map((identifier) => ({ identifier, enabled: true }))
      }
    ],
    squash_system_messages: false,
    wrap_in_quotes: false
  }
}
