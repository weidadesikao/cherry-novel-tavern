/**
 * Old-manuscript analysis engine (PRD §4.2 旧稿重塑, M5) — two selectable modes.
 *
 * Fast mode (`mode: 'whole'`): large-context models (e.g. DeepSeek V3.2, 128K)
 * can read a typical web-novel manuscript in one call, so the whole manuscript
 * goes into a single deep-extraction call that emits finished character cards,
 * organizations, relations, worldbook entries, events, outline, and style
 * profile at once — the model sees every character's whole arc. Explicitly
 * chosen by the user; an unusable reply is an error, never a silent downgrade.
 *
 * Normal mode (`mode: 'chunked'`, the default) — the original two-pass
 * map-reduce, for manuscripts beyond the context window or when the user wants
 * the finer-grained pipeline:
 *
 *  Pass 1 (map): per chunk, cheaply extract *mentions* — character names +
 *    aliases + a one-line evidence snippet of what each did in this chunk,
 *    plus organizations, relations, worldbook entries, and outline/style
 *    fragments. High recall, shallow.
 *
 *  Canonicalize: merge mentions across chunks by name/alias, accumulating ALL
 *    evidence snippets per character (alias 翔太/藤原翔太 → one character).
 *
 *  Pass 2 (reduce): for each major character, feed the model the accumulated
 *    evidence and synthesize a structured rich profile (定位/简介/性格/外貌/
 *    背景/状态变化). Depth comes from seeing all of a character at once.
 *
 *  Pass 3 (chapters): split the manuscript by its own headings (第N章/Chapter N;
 *    falling back to ~size blocks) so chapters carry real verbatim text, then
 *    digest each into a one-paragraph summary. Decoupled from the scan chunking.
 *
 * Reuses `window.api.ai.generateText` (non-streaming); the pure helpers
 * (chunking / parsing / canonicalization / merging / chapter splitting) are
 * isolated for testing.
 */

import { loggerService } from '@logger'

const logger = loggerService.withContext('NovelAnalysis')

/** Fast mode accepts manuscripts up to this many characters (~120K Chinese
 * chars stays well inside a 128K-token context with room for the prompt
 * scaffold and the JSON reply); the wizard blocks fast mode beyond it. */
export const WHOLE_BOOK_MAX_CHARS = 120_000
/** The whole-book call reads the entire manuscript and emits a large JSON —
 * allow far longer than a per-chunk call before giving up on it. */
export const WHOLE_BOOK_TIMEOUT_MS = 600_000

/** Chunk budget in characters — modest so each non-streaming call returns reliably. */
export const DEFAULT_CHUNK_SIZE = 5_000
/** Per-chunk overlap so an entity straddling a boundary is seen by both chunks. */
export const DEFAULT_CHUNK_OVERLAP = 400
/** A character needs at least this many mentions to get a Pass-2 deep profile. */
export const MIN_MENTIONS_FOR_PROFILE = 2
/** Per-model-call timeout (ms). A call exceeding it is skipped, not fatal. */
export const DEFAULT_CALL_TIMEOUT_MS = 90_000
/** Target chapter size (characters) for the fallback when no headings are found. */
export const DEFAULT_CHAPTER_SIZE = 10_000

// ============================================================================
// Result shapes (final, post-synthesis)
// ============================================================================

export interface AnalyzedCharacter {
  name: string
  aliases: string[]
  role: string
  status: string
  affiliation: string
  description: string
  personality: string
  appearance: string
  background: string
  statusChanges: string
}

export interface AnalyzedOrganization {
  name: string
  description: string
}

export interface AnalyzedRelation {
  fromName: string
  toName: string
  relationType: string
  description: string
}

export interface AnalyzedWorldbookEntry {
  keyword: string
  content: string
}

/** A story event for the timeline. `eventType` is a free string here; the
 * writer maps unknown values to 'other' against the DB enum. */
export interface AnalyzedEvent {
  title: string
  summary: string
  eventType: string
  storyTime: string
  location: string
  participants: string[]
}

export interface AnalyzedChapter {
  title: string
  /** The chapter's raw text (real word count; what gets written as chapter content). */
  content: string
  /** AI-generated one-paragraph digest of the chapter (written to the chapter outline). */
  summary: string
}

export interface AnalysisResult {
  characters: AnalyzedCharacter[]
  organizations: AnalyzedOrganization[]
  relations: AnalyzedRelation[]
  worldbook: AnalyzedWorldbookEntry[]
  events: AnalyzedEvent[]
  chapters: AnalyzedChapter[]
  styleProfile: string
  outline: string
}

// ============================================================================
// Pass-1 mention shapes (lightweight, per chunk)
// ============================================================================

export interface CharacterMention {
  name: string
  aliases: string[]
  /** One-line evidence: what this character did / revealed in this chunk. */
  fact: string
}

export interface ChunkMentions {
  characters: CharacterMention[]
  organizations: AnalyzedOrganization[]
  relations: AnalyzedRelation[]
  worldbook: AnalyzedWorldbookEntry[]
  events: AnalyzedEvent[]
  outlineFragment: string
  styleFragment: string
}

/** Accumulated evidence for one canonical character, gathered across chunks. */
export interface CharacterEvidence {
  canonicalName: string
  aliases: Set<string>
  facts: string[]
}

export interface AnalysisProgress {
  /** `whole` is the single whole-book call (indeterminate: total is 0). */
  phase: 'whole' | 'scan' | 'profile' | 'chapter'
  /** 1-based index of the unit (chunk / character / chapter) just processed. */
  current: number
  total: number
}

// ============================================================================
// Chunking
// ============================================================================

/**
 * Split text into overlapping chunks no larger than `size` characters,
 * preferring paragraph boundaries. `overlap` characters of the previous chunk's
 * tail are prepended to each next chunk so an entity spanning a boundary is
 * seen on both sides.
 */
export function chunkText(text: string, size: number = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_CHUNK_OVERLAP): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (normalized.length === 0) return []
  if (normalized.length <= size) return [normalized]

  const paragraphs = normalized.split(/\n{2,}/)
  const base: string[] = []
  let current = ''
  for (const para of paragraphs) {
    if (para.length > size) {
      if (current) {
        base.push(current)
        current = ''
      }
      for (let i = 0; i < para.length; i += size) base.push(para.slice(i, i + size))
      continue
    }
    if (current.length + para.length + 2 > size) {
      base.push(current)
      current = para
    } else {
      current = current ? `${current}\n\n${para}` : para
    }
  }
  if (current) base.push(current)

  if (overlap <= 0) return base
  return base.map((chunk, i) => (i === 0 ? chunk : `${base[i - 1].slice(-overlap)}\n\n${chunk}`))
}

// ============================================================================
// JSON extraction
// ============================================================================

/** Extract the first balanced JSON object from a model reply (tolerates fences/prose). */
export function extractJsonObject(reply: string): unknown {
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : reply
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return null
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(asString).filter(Boolean) : []
}

// ============================================================================
// Prompt instruction templates
//
// Each model call = an instruction template + a data payload the build
// function appends (novel text / chunk / evidence / chapter). The wizard shows
// the templates for editing; `{{token}}` placeholders are substituted at build
// time and documented per template.
// ============================================================================

/** Scan (normal mode, per chunk). Tokens: `{{index}}`, `{{total}}`. */
export const DEFAULT_SCAN_INSTRUCTIONS = [
  '你是小说结构分析助手。下面是一部小说的第 {{index}}/{{total}} 段节选。',
  '请只依据本段内容抽取信息，严格输出 JSON（不要任何额外解释、不要代码块以外的文字）：',
  '{',
  '  "characters": [{"name": "规范角色名(全名优先)", "aliases": ["本段出现的别名/简称/昵称"], "fact": "该角色在本段做了什么/透露了什么，一句话"}],',
  '  "organizations": [{"name": "组织或势力名", "description": "本段中该组织的相关信息，一句话"}],',
  '  "relations": [{"fromName": "角色或组织名", "toName": "角色或组织名", "relationType": "关系(如 母子/同学/隶属/敌对)", "description": "可空"}],',
  '  "worldbook": [{"keyword": "设定词条名", "content": "世界观/设定/专有名词说明，一句话"}],',
  '  "events": [{"title": "事件名(简短)", "summary": "事件经过，1-2 句", "eventType": "plot|turn|reveal|conflict|daily|other 之一", "storyTime": "故事内时间(如 当天清晨，可空)", "location": "发生地点(可空)", "participants": ["涉及的角色名"]}],',
  '  "outlineFragment": "本段在整体故事中的作用，一句话",',
  '  "styleFragment": "本段的叙事视角/句式/语言风格/氛围，一句话"',
  '}',
  '要求：name 用最规范的全名，同一角色的简称放进 aliases；relations 的 fromName/toName 必须与 characters/organizations 的 name 或 aliases 对应。本段没有的字段给空数组或空字符串。'
].join('\n')

/** Whole-book deep extraction (fast mode, single call). No tokens. */
export const DEFAULT_WHOLE_BOOK_INSTRUCTIONS = [
  '你是小说结构分析助手。下面是一部完整的小说文稿，请通读全书后一次性完成深度结构化分析。',
  '严格输出 JSON（不要任何额外解释、不要代码块以外的文字）：',
  '{',
  '  "characters": [{"name": "规范角色名(全名优先)", "aliases": ["全书出现过的别名/简称/昵称"], "role": "角色定位(主角/配角/反派/龙套等)", "status": "在场状态(活跃在场/已退场/死亡/未知等)", "affiliation": "所属组织/势力，没有则空", "description": "角色简介，2-4 句概括其身份与作用", "personality": "性格特点", "appearance": "外貌描写，没有信息则空", "background": "背景故事/经历", "statusChanges": "在故事中的状态或立场变化，没有则空"}],',
  '  "organizations": [{"name": "组织或势力名", "description": "该组织的性质与作用，1-2 句"}],',
  '  "relations": [{"fromName": "角色或组织名", "toName": "角色或组织名", "relationType": "关系(如 母子/同学/隶属/敌对)", "description": "可空"}],',
  '  "worldbook": [{"keyword": "设定词条名", "content": "世界观/设定/专有名词说明，1-2 句"}],',
  '  "events": [{"title": "事件名(简短)", "summary": "事件经过，1-2 句", "eventType": "plot|turn|reveal|conflict|daily|other 之一", "storyTime": "故事内时间(如 春游当日，可空)", "location": "发生地点(可空)", "participants": ["涉及的角色名"]}],',
  '  "outline": "全书大纲：按时间顺序概括主要剧情脉络，一段话(5-10 句)",',
  '  "styleProfile": "全书叙事视角/句式/语言风格/氛围的概括，2-3 句"',
  '}',
  '要求：',
  '- characters 只收主要角色与重要配角（最多 12 个），name 用最规范的全名，别名放 aliases；各字段依据全书综合提炼，不要编造，信息不足给空字符串。',
  '- relations 的 fromName/toName 必须与 characters/organizations 的 name 或 aliases 一致。',
  '- events 按发生顺序列出全书关键事件（8-20 条）。',
  '- 输出必须是合法 JSON。'
].join('\n')

/** Per-character profile synthesis (normal mode). Tokens: `{{name}}`, `{{aliases}}`. */
export const DEFAULT_PROFILE_INSTRUCTIONS = [
  '下面是小说角色「{{name}}」在全书各处的零散信息片段。请综合这些片段，提炼出该角色的结构化档案。',
  '别名/简称：{{aliases}}',
  '严格输出 JSON（不要任何额外解释、不要代码块以外的文字）：',
  '{',
  '  "role": "角色定位(主角/配角/反派/龙套等)",',
  '  "status": "在场状态(活跃在场/已退场/死亡/未知等)",',
  '  "affiliation": "所属组织/势力，没有则空",',
  '  "description": "角色简介，2-4 句概括其身份与作用",',
  '  "personality": "性格特点",',
  '  "appearance": "外貌描写，没有信息则空",',
  '  "background": "背景故事/经历",',
  '  "statusChanges": "在故事中的状态或立场变化，没有则空"',
  '}',
  '只依据给定片段，不要编造；信息不足的字段给空字符串。'
].join('\n')

/** Chapter digest (both modes, per chapter; plain prose reply). Tokens: `{{title}}`. */
export const DEFAULT_CHAPTER_DIGEST_INSTRUCTIONS =
  '请用 3-5 句话概括下面这一章「{{title}}」的剧情梗概，直接输出概括文字，不要任何前缀或解释。'

/** Per-call instruction overrides; missing entries use the defaults above. */
export interface AnalysisPrompts {
  scan?: string
  wholeBook?: string
  profile?: string
  chapterDigest?: string
}

// ============================================================================
// Pass 1 — per-chunk mention extraction
// ============================================================================

export function buildScanPrompt(
  chunk: string,
  index: number,
  total: number,
  instructions: string = DEFAULT_SCAN_INSTRUCTIONS
): string {
  const header = instructions.replaceAll('{{index}}', String(index + 1)).replaceAll('{{total}}', String(total))
  return [header, '', '【小说节选】', chunk].join('\n')
}

export function normalizeChunkMentions(parsed: unknown): ChunkMentions {
  const empty: ChunkMentions = {
    characters: [],
    organizations: [],
    relations: [],
    worldbook: [],
    events: [],
    outlineFragment: '',
    styleFragment: ''
  }
  if (!parsed || typeof parsed !== 'object') return empty
  const obj = parsed as Record<string, unknown>

  const characters: CharacterMention[] = Array.isArray(obj.characters)
    ? obj.characters
        .map((c) => {
          const r = c as Record<string, unknown>
          return { name: asString(r?.name), aliases: asStringArray(r?.aliases), fact: asString(r?.fact) }
        })
        .filter((c) => c.name)
    : []
  const organizations: AnalyzedOrganization[] = Array.isArray(obj.organizations)
    ? obj.organizations
        .map((o) => {
          const r = o as Record<string, unknown>
          return { name: asString(r?.name), description: asString(r?.description) }
        })
        .filter((o) => o.name)
    : []
  const relations: AnalyzedRelation[] = Array.isArray(obj.relations)
    ? obj.relations
        .map((rel) => {
          const r = rel as Record<string, unknown>
          return {
            fromName: asString(r?.fromName),
            toName: asString(r?.toName),
            relationType: asString(r?.relationType),
            description: asString(r?.description)
          }
        })
        .filter((r) => r.fromName && r.toName && r.relationType)
    : []
  const worldbook: AnalyzedWorldbookEntry[] = Array.isArray(obj.worldbook)
    ? obj.worldbook
        .map((w) => {
          const r = w as Record<string, unknown>
          return { keyword: asString(r?.keyword), content: asString(r?.content) }
        })
        .filter((w) => w.keyword && w.content)
    : []
  const events: AnalyzedEvent[] = Array.isArray(obj.events)
    ? obj.events
        .map((e) => {
          const r = e as Record<string, unknown>
          return {
            title: asString(r?.title),
            summary: asString(r?.summary),
            eventType: asString(r?.eventType),
            storyTime: asString(r?.storyTime),
            location: asString(r?.location),
            participants: asStringArray(r?.participants)
          }
        })
        .filter((e) => e.title)
    : []

  return {
    characters,
    organizations,
    relations,
    worldbook,
    events,
    outlineFragment: asString(obj.outlineFragment),
    styleFragment: asString(obj.styleFragment)
  }
}

// ============================================================================
// Fast mode — whole-book single-call extraction
// ============================================================================

export function buildWholeBookPrompt(text: string, instructions: string = DEFAULT_WHOLE_BOOK_INSTRUCTIONS): string {
  return [instructions, '', '【小说全文】', text].join('\n')
}

/** Everything the whole-book call yields; chapters are produced separately. */
export type WholeBookAnalysis = Omit<AnalysisResult, 'chapters'>

/**
 * Normalize the whole-book reply. Returns `null` when the reply is not an
 * object or yields zero named characters — the caller treats that as a failed
 * call rather than silently importing an empty skeleton. The non-character
 * collections share their shape (and key names) with the chunk scan, so their
 * normalization is delegated to {@link normalizeChunkMentions}; the merge
 * helpers de-dupe any repeats within the single reply.
 */
export function normalizeWholeBook(parsed: unknown): WholeBookAnalysis | null {
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>

  const characters: AnalyzedCharacter[] = Array.isArray(obj.characters)
    ? obj.characters
        .map((c) => {
          const r = c as Record<string, unknown>
          return {
            name: asString(r?.name),
            aliases: asStringArray(r?.aliases),
            role: asString(r?.role),
            status: asString(r?.status),
            affiliation: asString(r?.affiliation),
            description: asString(r?.description),
            personality: asString(r?.personality),
            appearance: asString(r?.appearance),
            background: asString(r?.background),
            statusChanges: asString(r?.statusChanges)
          }
        })
        .filter((c) => c.name)
    : []
  if (characters.length === 0) return null

  const shared = normalizeChunkMentions(parsed)
  return {
    characters,
    organizations: mergeOrganizations(shared.organizations),
    relations: mergeRelations(shared.relations),
    worldbook: mergeWorldbook(shared.worldbook),
    events: mergeEvents(shared.events),
    outline: asString(obj.outline),
    styleProfile: asString(obj.styleProfile)
  }
}

// ============================================================================
// Chapter splitting — by the novel's own headings, else by size
// ============================================================================

/**
 * A line is treated as a chapter heading when it is a SHORT standalone line
 * that starts with a chapter marker — `第N章/回/节/卷`, `卷N`, `Chapter N`, or a
 * bare leading number like `1.` / `01、`. The shortness guard keeps prose
 * sentences that merely contain "第二天…" from being mistaken for headings.
 */
const CHAPTER_HEADING =
  /^\s*(?:第\s*[0-9零一二三四五六七八九十百千两]+\s*[章回节卷]|卷\s*[0-9零一二三四五六七八九十]+|Chapter\s+\d+|[0-9]{1,3}\s*[、.．])/i
const MAX_HEADING_LEN = 30

interface RawChapter {
  title: string
  content: string
}

/**
 * Split a manuscript into chapters. Prefers the novel's own headings; if fewer
 * than two are found, falls back to ~`size`-character blocks broken at
 * paragraph boundaries. Returned `content` is the verbatim chapter text.
 */
export function splitChapters(text: string, size: number = DEFAULT_CHAPTER_SIZE): RawChapter[] {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (normalized.length === 0) return []

  const lines = normalized.split('\n')
  const headingIndices: number[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.length > 0 && line.length <= MAX_HEADING_LEN && CHAPTER_HEADING.test(line)) {
      headingIndices.push(i)
    }
  }

  if (headingIndices.length >= 2) {
    const chapters: RawChapter[] = []
    // Any text before the first heading is a prologue.
    if (headingIndices[0] > 0) {
      const pre = lines.slice(0, headingIndices[0]).join('\n').trim()
      if (pre) chapters.push({ title: '前言', content: pre })
    }
    for (let h = 0; h < headingIndices.length; h++) {
      const start = headingIndices[h]
      const end = h + 1 < headingIndices.length ? headingIndices[h + 1] : lines.length
      const title = lines[start].trim()
      const content = lines
        .slice(start + 1, end)
        .join('\n')
        .trim()
      chapters.push({ title, content })
    }
    return chapters.filter((c) => c.content.length > 0)
  }

  // Fallback: pack paragraphs into ~size-character blocks. Split on blank-line
  // paragraphs when the manuscript has them; otherwise (many novels use a single
  // newline per paragraph) split on every line so blocks land near `size`.
  const byBlank = normalized.split(/\n{2,}/)
  const usesBlankLines = byBlank.length > 1 && byBlank.every((p) => p.length <= size)
  const units = usesBlankLines ? byBlank : lines.map((l) => l.trim()).filter(Boolean)
  const joiner = usesBlankLines ? '\n\n' : '\n'

  const blocks: string[] = []
  let current = ''
  for (const unit of units) {
    if (current && current.length + unit.length + joiner.length > size) {
      blocks.push(current)
      current = unit
    } else {
      current = current ? `${current}${joiner}${unit}` : unit
    }
  }
  if (current) blocks.push(current)
  return blocks.map((content, i) => ({ title: `第${i + 1}章`, content }))
}

// ============================================================================
// Canonicalization — merge mentions across chunks
// ============================================================================

/**
 * Fold per-chunk character mentions into canonical evidence buckets, keyed by
 * name. Aliases let a later mention attach to an earlier canonical entry (and
 * vice-versa). Returns evidence ordered by first appearance.
 */
export function canonicalizeCharacters(mentions: CharacterMention[]): CharacterEvidence[] {
  const buckets: CharacterEvidence[] = []
  const keyToBucket = new Map<string, CharacterEvidence>()

  const lookup = (names: string[]): CharacterEvidence | undefined => {
    for (const name of names) {
      const found = keyToBucket.get(name)
      if (found) return found
    }
    return undefined
  }

  for (const mention of mentions) {
    const allNames = [mention.name, ...mention.aliases]
    let bucket = lookup(allNames)
    if (!bucket) {
      bucket = { canonicalName: mention.name, aliases: new Set(), facts: [] }
      buckets.push(bucket)
    }
    // Prefer the longest seen name as canonical (full names beat short forms).
    if (mention.name.length > bucket.canonicalName.length) {
      bucket.aliases.add(bucket.canonicalName)
      bucket.canonicalName = mention.name
    } else if (mention.name !== bucket.canonicalName) {
      bucket.aliases.add(mention.name)
    }
    for (const alias of mention.aliases) {
      if (alias !== bucket.canonicalName) bucket.aliases.add(alias)
    }
    if (mention.fact) bucket.facts.push(mention.fact)
    // (Re)index every known name to this bucket.
    for (const name of [bucket.canonicalName, ...bucket.aliases]) keyToBucket.set(name, bucket)
  }

  return buckets
}

// ============================================================================
// Merge the non-character (chunk-level) outputs
// ============================================================================

export function mergeOrganizations(parts: AnalyzedOrganization[]): AnalyzedOrganization[] {
  const byName = new Map<string, AnalyzedOrganization>()
  for (const o of parts) {
    const existing = byName.get(o.name)
    if (!existing || o.description.length > existing.description.length) byName.set(o.name, o)
  }
  return [...byName.values()]
}

export function mergeRelations(parts: AnalyzedRelation[]): AnalyzedRelation[] {
  const byKey = new Map<string, AnalyzedRelation>()
  for (const r of parts) {
    const key = `${r.fromName}|${r.toName}|${r.relationType}`
    const existing = byKey.get(key)
    if (!existing || r.description.length > existing.description.length) byKey.set(key, r)
  }
  return [...byKey.values()]
}

export function mergeWorldbook(parts: AnalyzedWorldbookEntry[]): AnalyzedWorldbookEntry[] {
  const byKey = new Map<string, AnalyzedWorldbookEntry>()
  for (const w of parts) {
    const existing = byKey.get(w.keyword)
    if (!existing || w.content.length > existing.content.length) byKey.set(w.keyword, w)
  }
  return [...byKey.values()]
}

/**
 * Merge events de-duped by title, keeping first-seen order (which approximates
 * the timeline since chunks are scanned in reading order). The richer summary
 * wins on a title collision.
 */
export function mergeEvents(parts: AnalyzedEvent[]): AnalyzedEvent[] {
  const byTitle = new Map<string, AnalyzedEvent>()
  for (const e of parts) {
    const existing = byTitle.get(e.title)
    if (!existing || e.summary.length > existing.summary.length) byTitle.set(e.title, e)
  }
  return [...byTitle.values()]
}

// ============================================================================
// Pass 2 — per-character profile synthesis
// ============================================================================

export function buildProfilePrompt(
  evidence: CharacterEvidence,
  instructions: string = DEFAULT_PROFILE_INSTRUCTIONS
): string {
  const header = instructions
    .replaceAll('{{name}}', evidence.canonicalName)
    .replaceAll('{{aliases}}', evidence.aliases.size > 0 ? [...evidence.aliases].join('、') : '无')
  return [header, '', '【信息片段】', ...evidence.facts.map((f, i) => `${i + 1}. ${f}`)].join('\n')
}

export function normalizeProfile(parsed: unknown, evidence: CharacterEvidence): AnalyzedCharacter {
  const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
  return {
    name: evidence.canonicalName,
    aliases: [...evidence.aliases],
    role: asString(obj.role),
    status: asString(obj.status),
    affiliation: asString(obj.affiliation),
    // Fall back to the joined evidence if the model returned nothing usable.
    description: asString(obj.description) || evidence.facts.slice(0, 3).join(' '),
    personality: asString(obj.personality),
    appearance: asString(obj.appearance),
    background: asString(obj.background),
    statusChanges: asString(obj.statusChanges)
  }
}

// ============================================================================
// Orchestration
// ============================================================================

function abortError(): DOMException {
  return new DOMException('Novel analysis aborted', 'AbortError')
}

/** Reject on timeout — and, when a signal is given, the moment it aborts, so
 * cancelling fast mode doesn't wait out a minutes-long in-flight call. */
function withTimeout<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      reject(abortError())
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`model call timed out after ${ms}ms`))
    }, ms)
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort)
    promise.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error)
      }
    )
  })
}

export interface AnalyzeOptions {
  uniqueModelId: string
  /** `chunked` (default) = the two-pass pipeline; `whole` = fast whole-book mode. */
  mode?: 'chunked' | 'whole'
  /** Instruction-template overrides for the model calls (wizard advanced settings). */
  prompts?: AnalysisPrompts
  chunkSize?: number
  /** Target chapter size for the heading-less fallback (characters). */
  chapterSize?: number
  onProgress?: (progress: AnalysisProgress) => void
  signal?: AbortSignal
  callTimeoutMs?: number
}

async function callModel(
  uniqueModelId: string,
  prompt: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<unknown> {
  const { text } = await withTimeout(window.api.ai.generateText({ uniqueModelId, prompt }), timeoutMs, signal)
  return extractJsonObject(text)
}

/**
 * Analyze a manuscript in the chosen mode (default: chunked two-pass). Both
 * modes finish with the chapter split + digest phase. Throws `AbortError`
 * when the signal fires.
 */
export async function analyzeNovel(text: string, options: AnalyzeOptions): Promise<AnalysisResult> {
  if (options.mode === 'whole') return analyzeWholeBook(text, options)
  return analyzeChunked(text, options)
}

/** Fast mode: one whole-book call, then the chapter phase. An unusable reply
 * is an error — the user chose this mode explicitly, so no silent downgrade. */
async function analyzeWholeBook(text: string, options: AnalyzeOptions): Promise<AnalysisResult> {
  if (options.signal?.aborted) throw abortError()
  // total 0 = indeterminate: one long call, no unit counter to show.
  options.onProgress?.({ phase: 'whole', current: 0, total: 0 })
  const { text: reply } = await withTimeout(
    window.api.ai.generateText({
      uniqueModelId: options.uniqueModelId,
      prompt: buildWholeBookPrompt(text, options.prompts?.wholeBook)
    }),
    options.callTimeoutMs ?? WHOLE_BOOK_TIMEOUT_MS,
    options.signal
  )
  const whole = normalizeWholeBook(extractJsonObject(reply))
  if (!whole) {
    logger.warn('whole-book reply yielded no usable analysis', { replyLength: reply.length })
    throw new Error('整本分析未能返回可用结果，请重试或改用正常模式')
  }
  const chapters = await digestChapters(text, options)
  return { ...whole, chapters }
}

/**
 * Normal mode: scan every chunk for mentions, canonicalize characters, then
 * synthesize a deep profile per major character, then the chapter phase.
 */
async function analyzeChunked(text: string, options: AnalyzeOptions): Promise<AnalysisResult> {
  const timeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS
  const chunks = chunkText(text, options.chunkSize)
  const checkAbort = () => {
    if (options.signal?.aborted) throw abortError()
  }

  // --- Pass 1: scan ---
  const allMentions: CharacterMention[] = []
  const orgParts: AnalyzedOrganization[] = []
  const relParts: AnalyzedRelation[] = []
  const wbParts: AnalyzedWorldbookEntry[] = []
  const eventParts: AnalyzedEvent[] = []
  const outlineFragments: string[] = []
  let styleProfile = ''

  options.onProgress?.({ phase: 'scan', current: 0, total: chunks.length })
  for (let i = 0; i < chunks.length; i++) {
    checkAbort()
    try {
      const parsed = await callModel(
        options.uniqueModelId,
        buildScanPrompt(chunks[i], i, chunks.length, options.prompts?.scan),
        timeoutMs,
        options.signal
      )
      const m = normalizeChunkMentions(parsed)
      allMentions.push(...m.characters)
      orgParts.push(...m.organizations)
      relParts.push(...m.relations)
      wbParts.push(...m.worldbook)
      eventParts.push(...m.events)
      if (m.outlineFragment) outlineFragments.push(m.outlineFragment)
      if (m.styleFragment.length > styleProfile.length) styleProfile = m.styleFragment
    } catch (error) {
      logger.warn('scan chunk failed, skipping', { chunk: i + 1, error })
    }
    options.onProgress?.({ phase: 'scan', current: i + 1, total: chunks.length })
  }

  // --- Canonicalize + pick major characters ---
  const evidence = canonicalizeCharacters(allMentions)
  const majors = evidence.filter((e) => e.facts.length >= MIN_MENTIONS_FOR_PROFILE)
  // If the novel is so short that nobody clears the bar, profile everyone.
  const toProfile = majors.length > 0 ? majors : evidence

  // --- Pass 2: synthesize per-character profiles ---
  const characters: AnalyzedCharacter[] = []
  options.onProgress?.({ phase: 'profile', current: 0, total: toProfile.length })
  for (let i = 0; i < toProfile.length; i++) {
    checkAbort()
    try {
      const parsed = await callModel(
        options.uniqueModelId,
        buildProfilePrompt(toProfile[i], options.prompts?.profile),
        timeoutMs,
        options.signal
      )
      characters.push(normalizeProfile(parsed, toProfile[i]))
    } catch (error) {
      logger.warn('profile synthesis failed, using evidence fallback', { name: toProfile[i].canonicalName, error })
      characters.push(normalizeProfile(null, toProfile[i]))
    }
    options.onProgress?.({ phase: 'profile', current: i + 1, total: toProfile.length })
  }

  const chapters = await digestChapters(text, options)

  return {
    characters,
    organizations: mergeOrganizations(orgParts),
    relations: mergeRelations(relParts),
    worldbook: mergeWorldbook(wbParts),
    events: mergeEvents(eventParts),
    chapters,
    styleProfile,
    outline: outlineFragments.join('\n\n')
  }
}

/**
 * Chapter phase, shared by both modes: split the manuscript by its own
 * headings (else by size) and digest each chapter. Content is the verbatim
 * chapter text; the model only writes a one-paragraph summary into the outline.
 */
async function digestChapters(text: string, options: AnalyzeOptions): Promise<AnalyzedChapter[]> {
  const timeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS
  const rawChapters = splitChapters(text, options.chapterSize)
  const chapters: AnalyzedChapter[] = []
  options.onProgress?.({ phase: 'chapter', current: 0, total: rawChapters.length })
  for (let i = 0; i < rawChapters.length; i++) {
    if (options.signal?.aborted) throw abortError()
    let summary = ''
    try {
      const { text: reply } = await withTimeout(
        window.api.ai.generateText({
          uniqueModelId: options.uniqueModelId,
          prompt: buildChapterDigestPrompt(rawChapters[i].title, rawChapters[i].content, options.prompts?.chapterDigest)
        }),
        timeoutMs,
        options.signal
      )
      summary = reply.trim()
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw error
      logger.warn('chapter digest failed, leaving summary empty', { chapter: i + 1, error })
    }
    chapters.push({ title: rawChapters[i].title, content: rawChapters[i].content, summary })
    options.onProgress?.({ phase: 'chapter', current: i + 1, total: rawChapters.length })
  }
  return chapters
}

/** Ask the model for a one-paragraph digest of a chapter (plain prose, no JSON). */
export function buildChapterDigestPrompt(
  title: string,
  content: string,
  instructions: string = DEFAULT_CHAPTER_DIGEST_INSTRUCTIONS
): string {
  return [instructions.replaceAll('{{title}}', title), '', content].join('\n')
}

/**
 * Resolve relation name-pairs to entity ids, given the name→id map built after
 * characters + organizations are written. Aliases are also indexed so a
 * relation referring to a character by a short form still resolves.
 */
export function resolveRelations(
  relations: AnalyzedRelation[],
  nameToId: Map<string, string>
): Array<{ fromEntityId: string; toEntityId: string; relationType: string; description: string }> {
  const resolved: Array<{ fromEntityId: string; toEntityId: string; relationType: string; description: string }> = []
  for (const relation of relations) {
    const fromEntityId = nameToId.get(relation.fromName)
    const toEntityId = nameToId.get(relation.toName)
    if (!fromEntityId || !toEntityId || fromEntityId === toEntityId) continue
    resolved.push({ fromEntityId, toEntityId, relationType: relation.relationType, description: relation.description })
  }
  return resolved
}
