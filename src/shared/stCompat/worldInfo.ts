/**
 * World Info trigger engine.
 *
 * Scans recent chat messages for entry keywords and decides which entries to
 * inject and where, following ST semantics: constant entries, selective
 * secondary-key logic, per-entry case sensitivity / whole-word matching,
 * regex keys (`/pattern/flags`), probability rolls, and position routing
 * (before/after char definitions, or at depth inside chat history).
 *
 * Recursive scanning (entry content re-triggering other entries) is a
 * deliberate first-phase omission (user decision): `enableRecursiveScan` is
 * reserved and must stay false.
 */

import type { ChatMessage, StPromptRole, StWorldbookEntry } from './types'
import { ST_SELECTIVE_LOGIC, ST_WI_POSITION } from './types'

export interface WorldInfoOptions {
  /** How many recent messages to scan when an entry has no own scanDepth. */
  scanDepth?: number
  /** Default case sensitivity when an entry has no own setting. */
  caseSensitive?: boolean
  /** Default whole-word matching when an entry has no own setting. */
  matchWholeWords?: boolean
  /** Injectable RNG for probability rolls (returns [0, 1)). Defaults to Math.random. */
  random?: () => number
  /** Reserved (M2: must stay false). */
  enableRecursiveScan?: boolean
}

export interface DepthInjection {
  depth: number
  role: StPromptRole
  content: string
  order: number
  source: string
}

export interface WorldInfoResult {
  /** Entries routed to the worldInfoBefore slot, in insertionOrder. */
  before: StWorldbookEntry[]
  /** Entries routed to the worldInfoAfter slot, in insertionOrder. */
  after: StWorldbookEntry[]
  /** Entries routed into chat history at depth. */
  depthInjections: DepthInjection[]
  /** All activated entries (for the prompt-inspector report). */
  activated: StWorldbookEntry[]
}

const DEFAULT_SCAN_DEPTH = 4

/** Parse an ST regex key of the form `/pattern/flags`; returns null for plain keys. */
function parseRegexKey(key: string): RegExp | null {
  if (key.length < 3 || !key.startsWith('/')) return null
  const lastSlash = key.lastIndexOf('/')
  if (lastSlash <= 0) return null
  const pattern = key.slice(1, lastSlash)
  const flags = key.slice(lastSlash + 1)
  try {
    return new RegExp(pattern, flags)
  } catch {
    return null
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function keyMatches(key: string, haystack: string, caseSensitive: boolean, wholeWords: boolean): boolean {
  const trimmed = key.trim()
  if (!trimmed) return false

  const regex = parseRegexKey(trimmed)
  if (regex) return regex.test(haystack)

  if (wholeWords) {
    // \b only works for ASCII word chars; CJK keys fall back to substring search.
    const hasWordBoundary = /^[\w]/.test(trimmed) && /[\w]$/.test(trimmed)
    if (hasWordBoundary) {
      const wordRegex = new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, caseSensitive ? '' : 'i')
      return wordRegex.test(haystack)
    }
  }

  if (caseSensitive) return haystack.includes(trimmed)
  return haystack.toLowerCase().includes(trimmed.toLowerCase())
}

function anyKeyMatches(keys: string[], haystack: string, caseSensitive: boolean, wholeWords: boolean): boolean {
  return keys.some((key) => keyMatches(key, haystack, caseSensitive, wholeWords))
}

function allKeysMatch(keys: string[], haystack: string, caseSensitive: boolean, wholeWords: boolean): boolean {
  return keys.every((key) => keyMatches(key, haystack, caseSensitive, wholeWords))
}

function isEntryActivated(
  entry: StWorldbookEntry,
  messages: ChatMessage[],
  options: WorldInfoOptions,
  random: () => number
): boolean {
  if (!entry.enabled) return false

  let triggered: boolean
  if (entry.constant) {
    triggered = true
  } else {
    const scanDepth = entry.scanDepth ?? options.scanDepth ?? DEFAULT_SCAN_DEPTH
    if (scanDepth <= 0 || entry.keys.length === 0) return false

    const haystack = messages
      .slice(-scanDepth)
      .map((message) => message.content)
      .join('\n')
    const caseSensitive = entry.caseSensitive ?? options.caseSensitive ?? false
    const wholeWords = entry.matchWholeWords ?? options.matchWholeWords ?? false

    triggered = anyKeyMatches(entry.keys, haystack, caseSensitive, wholeWords)

    if (triggered && entry.selective && (entry.secondaryKeys?.length ?? 0) > 0) {
      const secondary = entry.secondaryKeys as string[]
      const logic = entry.selectiveLogic ?? ST_SELECTIVE_LOGIC.AND_ANY
      switch (logic) {
        case ST_SELECTIVE_LOGIC.AND_ANY:
          triggered = anyKeyMatches(secondary, haystack, caseSensitive, wholeWords)
          break
        case ST_SELECTIVE_LOGIC.NOT_ALL:
          triggered = !allKeysMatch(secondary, haystack, caseSensitive, wholeWords)
          break
        case ST_SELECTIVE_LOGIC.NOT_ANY:
          triggered = !anyKeyMatches(secondary, haystack, caseSensitive, wholeWords)
          break
        case ST_SELECTIVE_LOGIC.AND_ALL:
          triggered = allKeysMatch(secondary, haystack, caseSensitive, wholeWords)
          break
        default:
          break
      }
    }
  }

  if (!triggered) return false

  if (entry.useProbability && entry.probability !== undefined && entry.probability < 100) {
    return random() * 100 < entry.probability
  }
  return true
}

export function matchWorldInfo(
  entries: StWorldbookEntry[],
  messages: ChatMessage[],
  options: WorldInfoOptions = {}
): WorldInfoResult {
  const random = options.random ?? Math.random
  const activated = entries.filter((entry) => isEntryActivated(entry, messages, options, random))

  const byOrder = (a: StWorldbookEntry, b: StWorldbookEntry) => a.insertionOrder - b.insertionOrder

  const before = activated.filter(
    (entry) => (entry.position ?? ST_WI_POSITION.BEFORE_CHAR) === ST_WI_POSITION.BEFORE_CHAR
  )
  const atDepth = activated.filter((entry) => entry.position === ST_WI_POSITION.AT_DEPTH)
  // Unsupported positions (author's note, example messages) degrade to "after char".
  const after = activated.filter(
    (entry) =>
      entry.position !== undefined &&
      entry.position !== ST_WI_POSITION.BEFORE_CHAR &&
      entry.position !== ST_WI_POSITION.AT_DEPTH
  )

  const depthInjections: DepthInjection[] = atDepth.sort(byOrder).map((entry) => ({
    depth: entry.depth ?? 0,
    role: entry.role ?? 'system',
    content: entry.content,
    order: entry.insertionOrder,
    source: `worldInfo:${entry.comment || entry.uid || 'entry'}`
  }))

  return {
    before: before.sort(byOrder),
    after: after.sort(byOrder),
    depthInjections,
    activated
  }
}
