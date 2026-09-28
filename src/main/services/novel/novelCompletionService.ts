/**
 * Main-process novel completion service.
 *
 * Stateless orchestration for Novel Studio's role-play / writing sessions:
 * the renderer assembles the full message array (via the stCompat engine) and
 * hands it here; we resolve the chosen model and dispatch the stream through
 * `AiStreamManager.streamPrompt` with a `WebContentsListener` keyed by a
 * `novel:${uuid}` streamId.
 *
 * Renderer subscribers consume chunks/done/error via the shared chat-stream
 * IPC channels (`Ai_StreamChunk` / `Ai_StreamDone` / `Ai_StreamError`) filtered
 * by that streamId; abort flows back through `Ai_Stream_Abort`.
 *
 * Mirrors `TranslateService` — a direct-import singleton, not a `BaseService`
 * (no long-lived resources). The IPC handler is registered by `AiService.onInit`.
 */

import { application } from '@application'
import { loggerService } from '@logger'
import type { CherryUIMessage } from '@main/ai/streamManager/types'
import { modelService } from '@main/data/services/ModelService'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'

import { WebContentsListener } from '../../ai/streamManager/listeners/WebContentsListener'

const logger = loggerService.withContext('NovelCompletionService')

/**
 * Namespaced prefix every novel stream uses for its `streamId` / `topicId`.
 * Ensures `Ai_Stream_Abort({ topicId })` cannot collide with a real chat topic
 * id. Kept in sync with the renderer-side literal in `NovelChatService.ts`.
 */
const NOVEL_STREAM_PREFIX = 'novel:'

export interface NovelCompletionMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface NovelCompletionRequest {
  /**
   * Renderer-generated streamId — must be prefixed `novel:`. The renderer
   * subscribes to `Ai_StreamChunk` / `Ai_StreamDone` / `Ai_StreamError` keyed
   * by this id **before** invoking `complete`, so the first chunk cannot land
   * before the listener is attached.
   */
  streamId: string
  /** `providerId::modelId` of the model to call. */
  uniqueModelId: string
  /** Fully-assembled message array (system/user/assistant), in order. */
  messages: NovelCompletionMessage[]
}

export interface NovelCompletionResult {
  /** Streaming id; renderer filters `Ai_Stream*` events by this. */
  streamId: string
}

function toCherryMessages(messages: NovelCompletionMessage[]): CherryUIMessage[] {
  return messages.map((message, index) => ({
    id: `novel-${index}`,
    role: message.role,
    parts: [{ type: 'text', text: message.content }]
  }))
}

export class NovelCompletionService {
  /**
   * IPC entry-point (called from `AiService.onInit`). Validates the request,
   * resolves the model, then dispatches the stream through
   * `AiStreamManager.streamPrompt`. Returns the `streamId` synchronously so the
   * renderer can subscribe to `Ai_StreamChunk/Done/Error` before chunks flow.
   */
  async complete(sender: Electron.WebContents, req: NovelCompletionRequest): Promise<NovelCompletionResult> {
    if (!req.streamId.startsWith(NOVEL_STREAM_PREFIX)) {
      throw new Error(`streamId must be prefixed '${NOVEL_STREAM_PREFIX}' (got '${req.streamId}')`)
    }
    if (!isUniqueModelId(req.uniqueModelId)) {
      throw new Error(`Invalid uniqueModelId: ${req.uniqueModelId}`)
    }
    if (req.messages.length === 0) {
      throw new Error('messages must not be empty')
    }

    const { providerId, modelId } = parseUniqueModelId(req.uniqueModelId)
    const model = await modelService.getByKey(providerId, modelId).catch(() => undefined)
    if (!model) {
      throw new Error(`Model not found: ${req.uniqueModelId}`)
    }

    const wcListener = new WebContentsListener(sender, req.streamId)
    const streamManager = application.get('AiStreamManager')
    streamManager.streamPrompt({
      streamId: req.streamId,
      uniqueModelId: req.uniqueModelId,
      messages: toCherryMessages(req.messages),
      listener: wcListener
    })

    logger.debug('novel stream opened', { streamId: req.streamId, uniqueModelId: req.uniqueModelId })
    return { streamId: req.streamId }
  }
}

export const novelCompletionService = new NovelCompletionService()
