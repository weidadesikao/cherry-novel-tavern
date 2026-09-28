/**
 * Novel Studio knowledge-base "reference mode" (PRD §5) — renderer side.
 *
 * The retrieval pipeline (embed recall → rerank) is Cherry's existing
 * `window.api.knowledge.search`, used verbatim — this module does NOT touch it.
 * The pure formatter (`buildReferenceBlock`) moved to `@shared/novel/assembly`
 * so the M10 main-side scaffold assembler can share it; only the
 * IPC-dependent retrieval wrapper stays here.
 */

import type { KnowledgeSearchResult } from '@shared/data/types/knowledge'
import type { NovelReferenceMode } from '@shared/data/types/novel'
import type { WebSearchResult } from '@shared/data/types/webSearch'
import { buildReferenceBlock, type ReferenceSources } from '@shared/novel/assembly'

export const REFERENCE_MODES = ['fact', 'style', 'imitate'] as const satisfies readonly NovelReferenceMode[]
export type ReferenceMode = NovelReferenceMode
export const DEFAULT_REFERENCE_MODE: ReferenceMode = 'fact'

export function isReferenceMode(value: string): value is ReferenceMode {
  return (REFERENCE_MODES as readonly string[]).includes(value)
}

export { buildReferenceBlock, type ReferenceSources }

export interface RetrieveReferencesInput {
  /** Selected knowledge base id, or undefined to skip knowledge retrieval. */
  baseId?: string
  /** Whether to run a parallel web search. */
  webEnabled: boolean
  /** The query (the user's writing instruction or latest message). */
  query: string
}

/**
 * Runs the existing retrieval pipeline and (optionally) a web search in
 * parallel. Each side fails soft: a retrieval error yields an empty list rather
 * than aborting the whole send, so writing is never blocked by RAG hiccups.
 */
export async function retrieveReferences(input: RetrieveReferencesInput): Promise<ReferenceSources> {
  const query = input.query.trim()
  if (query === '') {
    return { knowledge: [], web: [] }
  }

  const knowledgePromise: Promise<KnowledgeSearchResult[]> = input.baseId
    ? window.api.knowledge.search(input.baseId, query).catch(() => [])
    : Promise.resolve([])

  const webPromise: Promise<WebSearchResult[]> = input.webEnabled
    ? window.api.webSearch
        .searchKeywords({ keywords: [query] })
        .then((response) => response.results)
        .catch(() => [])
    : Promise.resolve([])

  const [knowledge, web] = await Promise.all([knowledgePromise, webPromise])
  return { knowledge, web }
}
