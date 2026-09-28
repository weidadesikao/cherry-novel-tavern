/**
 * Provider for novel workbench chat topics (M10 graft). A novel topic is a
 * REAL SQLite topic whose id carries the `novel-` prefix; everything about
 * persistence, branching, placeholders and streaming is inherited from
 * PersistentChatContextProvider. The only difference is the model-facing
 * history: instead of an assistant's `prompt` field, the session's ST assets
 * (preset / worldbook / character cards / timeline / writing context) are
 * assembled around the conversation on every send.
 */

import { messageService } from '@main/data/services/MessageService'
import { buildNovelScaffoldHistory } from '@main/services/novel/novelChatScaffold'
import { NOVEL_TOPIC_PREFIX } from '@shared/data/types/novel'

import type { CherryUIMessage } from '../types'
import { PersistentChatContextProvider } from './PersistentChatContextProvider'

export class NovelChatContextProvider extends PersistentChatContextProvider {
  override readonly name = 'novel'

  override canHandle(topicId: string): boolean {
    return topicId.startsWith(NOVEL_TOPIC_PREFIX)
  }

  /**
   * Root→anchor path like the persistent provider, then wrap it in the ST
   * scaffold. Assembly never throws (it degrades to the raw history), so a
   * broken config can't brick the send.
   */
  protected override async buildHistory(anchorMessageId: string): Promise<CherryUIMessage[]> {
    const realHistory = await super.buildHistory(anchorMessageId)
    const anchor = await messageService.getById(anchorMessageId)
    const { messages } = await buildNovelScaffoldHistory(anchor.topicId, realHistory)
    return messages
  }
}

export const novelChatContextProvider = new NovelChatContextProvider()
