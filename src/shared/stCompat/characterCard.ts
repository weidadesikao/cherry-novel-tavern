/**
 * ST Character Card (spec v2 JSON) parse / export.
 *
 * PNG-embedded cards are explicitly out of scope (PRD §1.1-5): only standard
 * JSON files are handled. Unknown fields pass through untouched.
 */

import type { ParseResult, StCharacterCard, StWarning } from './types'
import { StCharacterCardSchema } from './types'

export function parseCharacterCard(json: unknown): ParseResult<StCharacterCard> {
  const warnings: StWarning[] = []
  const raw = json as Record<string, unknown>

  // V1 cards put fields at the top level without spec/data. Wrap them.
  const looksLikeV1 = raw && typeof raw === 'object' && !('spec' in raw) && !('data' in raw) && 'name' in raw
  const candidate = looksLikeV1 ? { spec: 'chara_card_v2', spec_version: '2.0', data: raw } : json

  if (looksLikeV1) {
    warnings.push({
      code: 'character_card_v1',
      message: '检测到 V1 格式角色卡，已自动按 V2 结构导入'
    })
  }

  const card = StCharacterCardSchema.parse(candidate)

  if (card.spec !== 'chara_card_v2' && card.spec !== 'chara_card_v3') {
    warnings.push({
      code: 'unknown_card_spec',
      message: `未知的角色卡 spec「${card.spec}」，按 V2 结构尽力解析`
    })
  }

  if (!card.data.name.trim()) {
    warnings.push({ code: 'card_missing_name', message: '角色卡缺少名称' })
  }

  return { data: card, warnings }
}

/** Serialize back to a standard V2 JSON object (lossless for loose fields). */
export function exportCharacterCard(card: StCharacterCard): Record<string, unknown> {
  return {
    ...card,
    spec: 'chara_card_v2',
    spec_version: card.spec_version || '2.0'
  }
}
