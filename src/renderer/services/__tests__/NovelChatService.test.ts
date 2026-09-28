import type { AssembledMessage } from '@shared/stCompat'
import { describe, expect, it } from 'vitest'

import { toCompletionMessages } from '../NovelChatService'

describe('toCompletionMessages', () => {
  it('strips the engine source tag, keeping role + content in order', () => {
    const assembled: AssembledMessage[] = [
      { role: 'system', content: '你是林夜', source: 'charDescription' },
      { role: 'user', content: '你好', source: 'chatHistory' },
      { role: 'assistant', content: '我在', source: 'chatHistory' }
    ]

    expect(toCompletionMessages(assembled)).toEqual([
      { role: 'system', content: '你是林夜' },
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '我在' }
    ])
  })

  it('returns an empty array for empty input', () => {
    expect(toCompletionMessages([])).toEqual([])
  })
})
