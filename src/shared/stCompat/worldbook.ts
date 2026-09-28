/**
 * ST World Info file parse / export.
 *
 * File format: `{ entries: { "<uid>": {...} } }`. Modeled fields map onto the
 * normalized {@link StWorldbookEntry}; everything else is preserved verbatim
 * in `extra` so a round-trip export is lossless (dual-track rule).
 */

import type { ParseResult, StPromptRole, StWarning, StWorldbookEntry, StWorldbookFileEntry } from './types'
import { ST_WI_POSITION, StWorldbookFileSchema } from './types'

/** Raw-entry keys that map onto modeled StWorldbookEntry fields. */
const MODELED_FILE_KEYS = new Set([
  'uid',
  'key',
  'keysecondary',
  'comment',
  'content',
  'constant',
  'selective',
  'selectiveLogic',
  'order',
  'position',
  'depth',
  'disable',
  'probability',
  'useProbability',
  'scanDepth',
  'caseSensitive',
  'matchWholeWords',
  'role'
])

const WI_ROLE_MAP: Record<number, StPromptRole> = { 0: 'system', 1: 'user', 2: 'assistant' }
const WI_ROLE_REVERSE: Record<StPromptRole, number> = { system: 0, user: 1, assistant: 2 }

function fileEntryToInternal(parsed: StWorldbookFileEntry, raw: Record<string, unknown>): StWorldbookEntry {
  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!MODELED_FILE_KEYS.has(key)) extra[key] = value
  }

  return {
    uid: parsed.uid,
    keys: parsed.key,
    secondaryKeys: parsed.keysecondary.length > 0 ? parsed.keysecondary : undefined,
    comment: parsed.comment || undefined,
    content: parsed.content,
    enabled: !parsed.disable,
    constant: parsed.constant,
    selective: parsed.selective,
    selectiveLogic: parsed.selectiveLogic,
    position: parsed.position,
    depth: parsed.depth,
    insertionOrder: parsed.order,
    probability: parsed.probability,
    useProbability: parsed.useProbability,
    scanDepth: parsed.scanDepth ?? undefined,
    caseSensitive: parsed.caseSensitive ?? undefined,
    matchWholeWords: parsed.matchWholeWords ?? undefined,
    role: parsed.role != null ? WI_ROLE_MAP[parsed.role] : undefined,
    extra: Object.keys(extra).length > 0 ? extra : undefined
  }
}

export function parseWorldbook(json: unknown): ParseResult<StWorldbookEntry[]> {
  const file = StWorldbookFileSchema.parse(json)
  const warnings: StWarning[] = []

  // A world-info file without an `entries` map is almost certainly a different
  // ST asset (preset / character card). Warn instead of silently importing an
  // empty book — the import UI surfaces this to the user.
  const rawJson = json as Record<string, unknown> | null
  if (!rawJson || typeof rawJson !== 'object' || typeof rawJson.entries !== 'object' || rawJson.entries === null) {
    warnings.push({
      code: 'not_a_worldbook',
      message: '该 JSON 中没有找到世界书条目（entries）——它可能是预设或角色卡文件，而不是世界书'
    })
  }

  const rawEntries = (rawJson?.entries ?? {}) as Record<string, Record<string, unknown>>

  const entries = Object.entries(file.entries).map(([id, parsed]) => {
    const entry = fileEntryToInternal(parsed, rawEntries[id] ?? {})

    if (entry.extra?.preventRecursion || entry.extra?.excludeRecursion || entry.extra?.delayUntilRecursion) {
      warnings.push({
        code: 'recursion_not_supported',
        message: `世界书条目「${entry.comment || id}」使用了递归扫描相关设置，当前引擎未启用递归扫描`
      })
    }
    const position = entry.position
    if (
      position !== undefined &&
      position !== ST_WI_POSITION.BEFORE_CHAR &&
      position !== ST_WI_POSITION.AFTER_CHAR &&
      position !== ST_WI_POSITION.AT_DEPTH
    ) {
      warnings.push({
        code: 'unsupported_wi_position',
        message: `世界书条目「${entry.comment || id}」的插入位置 ${position} 暂不支持，将按“角色定义之后”处理`
      })
    }
    return entry
  })

  return { data: entries, warnings }
}

/** Serialize internal entries back to the ST world info file format. */
export function exportWorldbook(entries: StWorldbookEntry[]): Record<string, unknown> {
  const fileEntries: Record<string, unknown> = {}

  entries.forEach((entry, index) => {
    const uid = entry.uid ?? index
    fileEntries[String(uid)] = {
      ...entry.extra,
      uid,
      key: entry.keys,
      keysecondary: entry.secondaryKeys ?? [],
      comment: entry.comment ?? '',
      content: entry.content,
      constant: entry.constant,
      selective: entry.selective,
      selectiveLogic: entry.selectiveLogic ?? 0,
      order: entry.insertionOrder,
      position: entry.position ?? 0,
      ...(entry.depth !== undefined ? { depth: entry.depth } : {}),
      disable: !entry.enabled,
      probability: entry.probability ?? 100,
      useProbability: entry.useProbability ?? false,
      ...(entry.scanDepth !== undefined ? { scanDepth: entry.scanDepth } : {}),
      ...(entry.caseSensitive !== undefined ? { caseSensitive: entry.caseSensitive } : {}),
      ...(entry.matchWholeWords !== undefined ? { matchWholeWords: entry.matchWholeWords } : {}),
      ...(entry.role !== undefined ? { role: WI_ROLE_REVERSE[entry.role] } : {})
    }
  })

  return { entries: fileEntries }
}
