/**
 * Renderer shim — the implementation moved to `@shared/novel/assembly` so the
 * M10 main-side chat graft (`NovelChatContextProvider`) can assemble with the
 * exact same code. M9 call sites and tests keep importing from here.
 */

export {
  assembleSession,
  type AssembleSessionInput,
  entitiesToCardJson,
  entityToCardJson,
  type RoleplayChatMessage
} from '@shared/novel/assembly'
