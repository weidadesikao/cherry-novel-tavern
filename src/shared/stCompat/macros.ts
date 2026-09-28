/**
 * ST macro substitution — `{{char}}`, `{{user}}`, etc.
 *
 * Implements the high-frequency subset (PRD §2.2-5). Macro names are
 * case-insensitive like in ST. Unknown macros are left untouched and
 * reported so callers can surface them instead of silently dropping them.
 */

import type { MacroContext } from './types'

const MACRO_PATTERN = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g

function buildMacroMap(ctx: MacroContext): Map<string, string> {
  const map = new Map<string, string>()
  const set = (name: string, value: string | undefined) => {
    if (value !== undefined) map.set(name.toLowerCase(), value)
  }

  set('char', ctx.char)
  set('user', ctx.user)
  set('description', ctx.description)
  set('personality', ctx.personality)
  set('scenario', ctx.scenario)
  set('persona', ctx.persona)
  // ST aliases
  set('bot', ctx.char)

  for (const [name, value] of Object.entries(ctx.extra ?? {})) {
    set(name, value)
  }
  return map
}

export interface MacroResult {
  text: string
  /** Macro names found in the text but not present in the context. */
  unknownMacros: string[]
}

export function substituteMacros(text: string, ctx: MacroContext): MacroResult {
  const map = buildMacroMap(ctx)
  const unknown = new Set<string>()

  const result = text.replace(MACRO_PATTERN, (match, name: string) => {
    const value = map.get(name.toLowerCase())
    if (value === undefined) {
      unknown.add(name)
      return match
    }
    return value
  })

  return { text: result, unknownMacros: [...unknown] }
}
