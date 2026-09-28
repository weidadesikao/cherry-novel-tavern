import type { AssembledMessage } from '@shared/stCompat'
import { v4 as uuid } from 'uuid'

/** Must stay in sync with main-side prefix (validated in `novelCompletionService.complete`). */
const NOVEL_STREAM_PREFIX = 'novel:'

export interface NovelChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** Strip the engine's `source` tag — main only needs role + content. */
export function toCompletionMessages(assembled: AssembledMessage[]): NovelChatMessage[] {
  return assembled.map(({ role, content }) => ({ role, content }))
}

/**
 * Stream a novel role-play / writing completion through main's
 * `Ai_Novel_Complete` IPC. The caller passes the fully-assembled message array
 * (from the stCompat engine) and the model to use. Per-chunk
 * `onDelta(accumulated)` paces the display; `signal` aborts via `Ai_Stream_Abort`.
 *
 * Mirrors `translateText` in `TranslateService.ts`: subscribe to the shared
 * `Ai_Stream*` channels (filtered by a fresh `novel:${uuid}` streamId) BEFORE
 * invoking main, so the first chunk cannot land before the listener attaches.
 */
export const streamNovelCompletion = async (
  uniqueModelId: string,
  messages: NovelChatMessage[],
  onDelta?: (accumulated: string) => void,
  signal?: AbortSignal
): Promise<string> => {
  if (signal?.aborted) {
    throw new DOMException('Novel completion aborted before start', 'AbortError')
  }
  if (messages.length === 0) {
    throw new Error('messages must not be empty')
  }

  const streamId = `${NOVEL_STREAM_PREFIX}${uuid()}`

  let accumulated = ''
  let cleaned = false
  const unsubscribers: Array<() => void> = []

  let abortListener: (() => void) | undefined
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    for (const off of unsubscribers) {
      try {
        off()
      } catch {
        // listener unsub never throws meaningfully
      }
    }
    if (signal && abortListener) signal.removeEventListener('abort', abortListener)
  }

  if (signal) {
    abortListener = () => {
      void window.api.ai.streamAbort({ topicId: streamId }).catch(() => {
        // Already aborted / stream gone — main drives the final reject via onStreamError.
      })
    }
    signal.addEventListener('abort', abortListener, { once: true })
  }

  return new Promise<string>((resolve, reject) => {
    unsubscribers.push(
      window.api.ai.onStreamChunk(({ topicId, chunk }) => {
        if (topicId !== streamId) return
        if (
          chunk &&
          (chunk as { type?: string }).type === 'text-delta' &&
          typeof (chunk as { delta?: unknown }).delta === 'string'
        ) {
          accumulated += (chunk as { delta: string }).delta
          onDelta?.(accumulated)
        }
      })
    )

    unsubscribers.push(
      window.api.ai.onStreamDone(({ topicId }) => {
        if (topicId !== streamId) return
        cleanup()
        resolve(accumulated)
      })
    )

    unsubscribers.push(
      window.api.ai.onStreamError(({ topicId, error }) => {
        if (topicId !== streamId) return
        cleanup()
        // Preserve error.name (e.g. 'AbortError') so callers classify user stops correctly.
        const err = new Error(error?.message ?? 'Novel completion stream error')
        if (error?.name) err.name = error.name
        reject(err)
      })
    )

    window.api.novel.complete({ streamId, uniqueModelId, messages }).catch((openError: unknown) => {
      cleanup()
      reject(openError instanceof Error ? openError : new Error(String(openError)))
    })
  })
}
