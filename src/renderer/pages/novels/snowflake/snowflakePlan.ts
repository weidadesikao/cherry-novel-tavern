/**
 * Snowflake structured-creation planning (PRD §4.1 结构化创作, M8).
 *
 * Two model calls, mirroring the snowflake method's first expansions:
 *
 *  1. Proposals — from a one-line inspiration, generate N selectable novel
 *     proposals (title / logline / synopsis / main characters).
 *  2. Volume plan — expand the chosen proposal into a volume + chapter
 *     skeleton whose outlines can directly drive writing.
 *
 * Pure helpers (prompt building / normalization) are isolated for testing;
 * the wizard page owns the `window.api.ai.generateText` calls.
 */

import { extractJsonObject } from '../remodel/novelAnalysis'

export interface PlanCharacter {
  name: string
  role: string
  description: string
}

export interface NovelProposal {
  title: string
  /** One-sentence story (snowflake step 1). */
  logline: string
  /** Multi-paragraph synopsis (beginning / development / turn / ending). */
  synopsis: string
  characters: PlanCharacter[]
}

export interface PlannedChapter {
  title: string
  outline: string
}

export interface PlannedVolume {
  title: string
  summary: string
  chapters: PlannedChapter[]
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

// ============================================================================
// Step 1 — proposals from an inspiration line
// ============================================================================

export function buildProposalPrompt(inspiration: string, count: number): string {
  return [
    `你是小说策划助手。根据下面的创意灵感，构思 ${count} 个可选的小说方案。`,
    '严格输出 JSON（不要任何额外解释、不要代码块以外的文字）：',
    '{',
    '  "proposals": [{',
    '    "title": "书名",',
    '    "logline": "一句话故事：25 字左右概括核心冲突",',
    '    "synopsis": "故事大纲：起因、发展、转折、结局各一段，共 4 段",',
    '    "characters": [{"name": "角色名", "role": "主角/反派/关键配角", "description": "一句话人物设定（动机+缺陷）"}]',
    '  }]',
    '}',
    `要求：恰好生成 ${count} 个方案；每个方案 3-6 个主要人物；多个方案之间取向应有明显差异（题材、基调或视角）。`,
    '',
    '【创意灵感】',
    inspiration
  ].join('\n')
}

export function normalizeProposals(parsed: unknown): NovelProposal[] {
  if (!parsed || typeof parsed !== 'object') return []
  const list = (parsed as Record<string, unknown>).proposals
  if (!Array.isArray(list)) return []
  return list
    .map((p) => {
      const r = p as Record<string, unknown>
      const characters: PlanCharacter[] = Array.isArray(r?.characters)
        ? r.characters
            .map((c) => {
              const cr = c as Record<string, unknown>
              return { name: asString(cr?.name), role: asString(cr?.role), description: asString(cr?.description) }
            })
            .filter((c) => c.name)
        : []
      return {
        title: asString(r?.title),
        logline: asString(r?.logline),
        synopsis: asString(r?.synopsis),
        characters
      }
    })
    .filter((p) => p.title)
}

// ============================================================================
// Step 2 — volume + chapter skeleton for the chosen proposal
// ============================================================================

export function buildVolumePlanPrompt(proposal: NovelProposal): string {
  return [
    '你是小说结构规划助手。基于下面已确定的小说方案，按雪花法展开分卷与章节骨架。',
    '严格输出 JSON（不要任何额外解释、不要代码块以外的文字）：',
    '{',
    '  "volumes": [{',
    '    "title": "卷名（如 第一卷·雾起）",',
    '    "summary": "本卷主线，2-3 句",',
    '    "chapters": [{"title": "章节标题", "outline": "本章剧情要点，2-4 句"}]',
    '  }]',
    '}',
    '要求：2-4 卷，每卷 4-8 章；章节 outline 要能直接指导写作（谁做了什么、留下什么悬念）；全书结构完整（开端-发展-高潮-结局）。',
    '',
    '【小说方案】',
    `书名：${proposal.title}`,
    `一句话故事：${proposal.logline}`,
    '故事大纲：',
    proposal.synopsis,
    '主要人物：',
    ...proposal.characters.map((c) => `- ${c.name}（${c.role}）：${c.description}`)
  ].join('\n')
}

export function normalizeVolumes(parsed: unknown): PlannedVolume[] {
  if (!parsed || typeof parsed !== 'object') return []
  const list = (parsed as Record<string, unknown>).volumes
  if (!Array.isArray(list)) return []
  return list
    .map((v) => {
      const r = v as Record<string, unknown>
      const chapters: PlannedChapter[] = Array.isArray(r?.chapters)
        ? r.chapters
            .map((c) => {
              const cr = c as Record<string, unknown>
              return { title: asString(cr?.title), outline: asString(cr?.outline) }
            })
            .filter((c) => c.title)
        : []
      return { title: asString(r?.title), summary: asString(r?.summary), chapters }
    })
    .filter((v) => v.title && v.chapters.length > 0)
}

// ============================================================================
// Import helpers — flatten the plan into DB-shaped rows
// ============================================================================

/** Chapter title carries its volume prefix when the plan has multiple volumes
 * (the chapter table has no volume column). */
export function flattenVolumes(volumes: PlannedVolume[]): PlannedChapter[] {
  if (volumes.length <= 1) return volumes.flatMap((v) => v.chapters)
  return volumes.flatMap((v) => v.chapters.map((c) => ({ title: `${v.title}·${c.title}`, outline: c.outline })))
}

/** Synopsis = logline + synopsis + volume plan digest, capped by the caller. */
export function composeSynopsis(proposal: NovelProposal, volumes: PlannedVolume[]): string {
  const volumeLines = volumes.map((v) => `${v.title}：${v.summary}`)
  return [proposal.logline, proposal.synopsis, volumeLines.length > 0 ? `【分卷规划】\n${volumeLines.join('\n')}` : '']
    .filter(Boolean)
    .join('\n\n')
}

export { extractJsonObject }
