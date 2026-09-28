import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea
} from '@cherrystudio/ui'
import { dataApiService } from '@data/DataApiService'
import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledgeBase'
import { useDefaultModel, useModels } from '@renderer/hooks/useModel'
import { streamNovelCompletion, toCompletionMessages } from '@renderer/services/NovelChatService'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { useNavigate, useParams } from '@tanstack/react-router'
import {
  BookOpen,
  Braces,
  ChevronDown,
  ChevronLeft,
  Eraser,
  Eye,
  EyeOff,
  FileJson,
  Import,
  ListChecks,
  PenLine,
  Save,
  Send,
  Square
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import AssetJsonDialog from '../components/AssetJsonDialog'
import PresetEntryToggleDialog from '../components/PresetEntryToggleDialog'
import {
  buildReferenceBlock,
  DEFAULT_REFERENCE_MODE,
  REFERENCE_MODES,
  type ReferenceMode,
  retrieveReferences
} from '../novelReference'
import { assembleSession, entitiesToCardJson } from '../roleplay/assembleSession'
import { formatTimelineBlock } from './timelineBlock'
import { formatWorldbookBlock } from './worldbookBlock'

const NO_KNOWLEDGE_BASE = 'none'
const NONE = '__none__'
/** History rounds sentinel: include the whole conversation. */
const ROUNDS_ALL = -1
const ROUNDS_OPTIONS = [0, 2, 4, 8, 16, ROUNDS_ALL] as const
const PREV_CHAPTER_OPTIONS = [0, 1, 2, 3, 5] as const

interface WriteChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface SentMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const WriteWorkbenchPage = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { novelId, chapterId } = useParams({ strict: false }) as { novelId: string; chapterId: string }

  const { defaultModel } = useDefaultModel()
  const { models } = useModels({ enabled: true })
  const { bases: knowledgeBases } = useKnowledgeBases()
  const readyBases = knowledgeBases.filter((base) => base.status === 'completed')
  const [modelId, setModelId] = useState<string>('')

  // Knowledge-base "reference mode" (PRD §5): retrieval pipeline is unchanged;
  // the selected mode only reframes how retrieved excerpts are injected.
  const [knowledgeBaseId, setKnowledgeBaseId] = useState<string>(NO_KNOWLEDGE_BASE)
  const [referenceMode, setReferenceMode] = useState<ReferenceMode>(DEFAULT_REFERENCE_MODE)
  const [webEnabled, setWebEnabled] = useState(false)
  // Context controls: how many previous chapters ride along, and how many
  // conversation rounds are replayed into each request.
  const [prevChapterCount, setPrevChapterCount] = useState(0)
  const [historyRounds, setHistoryRounds] = useState(8)
  // Editable system prompt (defaults to the built-in writing prompt).
  const [systemPrompt, setSystemPrompt] = useState(() => t('novels.write.system_prompt'))
  const [promptDialogOpen, setPromptDialogOpen] = useState(false)
  // ST assets: preset / worldbook / character cards assembled via the M4 engine.
  const [presetId, setPresetId] = useState<string>(NONE)
  const [worldbookId, setWorldbookId] = useState<string>(NONE)
  const [entityIds, setEntityIds] = useState<string[]>([])
  // Which of the preset's prompt_order lists drives assembly (ST default 100001).
  const [orderCharacterId, setOrderCharacterId] = useState('100001')
  const [entriesDialogOpen, setEntriesDialogOpen] = useState(false)
  // Carry the novel's timeline events into the writing context.
  const [carryTimeline, setCarryTimeline] = useState(false)
  const [jsonDialog, setJsonDialog] = useState<{
    kind: 'preset' | 'worldbook' | 'card' | 'assembled'
    title: string
  } | null>(null)
  const presetFileRef = useRef<HTMLInputElement>(null)
  const worldbookFileRef = useRef<HTMLInputElement>(null)
  // The exact message array of the last send, for the prompt viewer.
  const [lastSent, setLastSent] = useState<SentMessage[] | null>(null)
  const [showPrompt, setShowPrompt] = useState(false)
  // Seed the picker with the global default model once it resolves.
  useEffect(() => {
    if (defaultModel && modelId === '') setModelId(defaultModel.id)
  }, [defaultModel, modelId])

  const { data: chapters } = useQuery('/novels/:novelId/chapters', { params: { novelId } })
  const { data: chapter } = useQuery('/novels/:novelId/chapters/:chapterId', {
    params: { novelId, chapterId }
  })

  // ST asset sources: preset list / worldbook list / this novel's characters.
  const { data: presets, refetch: refetchPresets } = useQuery('/st-presets')
  const { data: worldbooks, refetch: refetchWorldbooks } = useQuery('/worldbooks')
  const { data: entities } = useQuery('/novels/:novelId/entities', { params: { novelId } })
  const characters = useMemo(() => (entities ?? []).filter((entity) => entity.type === 'character'), [entities])
  const selectedEntities = useMemo(
    () => characters.filter((entity) => entityIds.includes(entity.id)),
    [characters, entityIds]
  )
  const cardJson = useMemo(() => entitiesToCardJson(selectedEntities), [selectedEntities])
  const { data: presetDetail } = useQuery('/st-presets/:presetId', {
    params: { presetId },
    enabled: presetId !== NONE
  })
  const { data: worldbookDetail } = useQuery('/worldbooks/:worldbookId', {
    params: { worldbookId },
    enabled: worldbookId !== NONE
  })
  const { data: timelineEvents } = useQuery('/novels/:novelId/events', {
    params: { novelId },
    enabled: carryTimeline
  })

  // The preset's available prompt_order lists, with per-list enabled counts.
  const orderOptions = useMemo(() => {
    const orders = ((presetDetail?.json as Record<string, unknown> | undefined)?.prompt_order ?? []) as Array<
      Record<string, unknown>
    >
    return orders.map((order) => {
      const entries = (order.order as Array<Record<string, unknown>> | undefined) ?? []
      return {
        id: String(order.character_id),
        total: entries.length,
        enabled: entries.filter((entry) => entry.enabled === true).length
      }
    })
  }, [presetDetail])

  // Keep the selection valid when switching presets.
  useEffect(() => {
    if (orderOptions.length === 0) return
    if (!orderOptions.some((option) => option.id === orderCharacterId)) {
      const preferred = orderOptions.find((option) => option.id === '100001') ?? orderOptions[0]
      setOrderCharacterId(preferred.id)
    }
  }, [orderOptions, orderCharacterId])

  const { trigger: importPreset } = useMutation('POST', '/st-presets', { refresh: ['/st-presets'] })
  const { trigger: importWorldbook } = useMutation('POST', '/worldbooks/import:st', { refresh: ['/worldbooks'] })
  const { trigger: patchPreset } = useMutation('PATCH', '/st-presets/:presetId', {
    refresh: ({ args }) => ['/st-presets', `/st-presets/${args!.params.presetId}`]
  })

  const { trigger: updateChapter, isLoading: isSaving } = useMutation('PATCH', '/novels/:novelId/chapters/:chapterId', {
    refresh: ({ args }) => [`/novels/${args!.params.novelId}/chapters`]
  })

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const loadedChapterId = useRef<string | null>(null)

  // Load chapter into the editor once per chapter id (don't clobber edits on refetch).
  useEffect(() => {
    if (chapter && loadedChapterId.current !== chapter.id) {
      setTitle(chapter.title)
      setContent(chapter.content)
      setDirty(false)
      loadedChapterId.current = chapter.id
    }
  }, [chapter])

  const [history, setHistory] = useState<WriteChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const handleSave = async () => {
    try {
      await updateChapter({
        params: { novelId, chapterId },
        body: { title: title.trim() || t('novels.chapters.untitled'), content }
      })
      setDirty(false)
      window.toast.success(t('novels.write.saved'))
    } catch (error) {
      window.toast.error(formatErrorMessageWithPrefix(error, t('novels.write.save_failed')))
    }
  }

  const [jsonDialogData, setJsonDialogData] = useState<unknown>(null)
  const [jsonDialogNotices, setJsonDialogNotices] = useState<Array<{ text: string; tone?: 'info' | 'warn' }>>([])

  const importAssetFile = async (file: File, kind: 'preset' | 'worldbook') => {
    try {
      const json: unknown = JSON.parse(await file.text())
      const name = file.name.replace(/\.json$/i, '')
      if (kind === 'preset') {
        const { warnings } = await importPreset({ body: { name, json } })
        window.toast.success(t('novels.st_assets.import_success', { count: warnings.length }))
        void refetchPresets()
      } else {
        const { warnings } = await importWorldbook({ body: { name, json } })
        if (warnings.some((warning) => warning.code === 'not_a_worldbook')) {
          window.toast.error(t('novels.st_assets.not_a_worldbook'))
        } else {
          window.toast.success(t('novels.st_assets.import_success', { count: warnings.length }))
        }
        void refetchWorldbooks()
      }
    } catch (error) {
      window.toast.error(formatErrorMessageWithPrefix(error, t('novels.st_assets.import_failed')))
    }
  }

  const openJsonDialog = async (kind: 'preset' | 'worldbook' | 'card') => {
    try {
      if (kind === 'preset' && presetId !== NONE) {
        setJsonDialogData(presetDetail?.json ?? {})
        setJsonDialog({ kind, title: (presets ?? []).find((p) => p.id === presetId)?.name ?? '' })
      } else if (kind === 'worldbook' && worldbookId !== NONE) {
        // View/edit the regenerated standard ST world-info JSON.
        const exported = await dataApiService.get(`/worldbooks/${worldbookId}/export:st`)
        setJsonDialogData(exported)
        setJsonDialog({ kind, title: (worldbooks ?? []).find((w) => w.id === worldbookId)?.name ?? '' })
      } else if (kind === 'card' && cardJson) {
        setJsonDialogData(cardJson)
        setJsonDialog({ kind, title: selectedEntities.map((entity) => entity.name).join('、') })
      }
    } catch (error) {
      window.toast.error(formatErrorMessageWithPrefix(error, t('novels.st_assets.load_failed')))
    }
  }

  const handleJsonSave = async (json: unknown) => {
    if (!jsonDialog) return
    if (jsonDialog.kind === 'preset') {
      await patchPreset({ params: { presetId }, body: { json } })
    } else if (jsonDialog.kind === 'worldbook') {
      const name = (worldbooks ?? []).find((w) => w.id === worldbookId)?.name ?? jsonDialog.title
      await importWorldbook({ body: { name, json, worldbookId } })
      void refetchWorldbooks()
    }
    window.toast.success(t('novels.st_assets.json_saved'))
  }

  /** Fetch the full text of up to `prevChapterCount` chapters before this one. */
  const fetchPreviousChapters = async (): Promise<string> => {
    if (prevChapterCount === 0 || !chapters) return ''
    const index = chapters.findIndex((item) => item.id === chapterId)
    if (index <= 0) return ''
    const previous = chapters.slice(Math.max(0, index - prevChapterCount), index)
    const bodies = await Promise.all(
      previous.map(async (item) => {
        try {
          // The template path matches two endpoint patterns in the type map;
          // narrow to the chapter shape this URL actually returns.
          const full = (await dataApiService.get(`/novels/${novelId}/chapters/${item.id}`)) as {
            title: string
            content: string
          }
          return full.content.trim() ? `《${full.title}》\n${full.content}` : ''
        } catch {
          return ''
        }
      })
    )
    const parts = bodies.filter(Boolean)
    return parts.length > 0 ? `【前情章节】\n${parts.join('\n\n')}` : ''
  }

  /** Writing-context system block: editable prompt + prev chapters + current
   * chapter text + (optionally) the novel timeline. Shared by preview & send. */
  const buildSystemBlock = async (): Promise<string> => {
    let system = systemPrompt.trim() || t('novels.write.system_prompt')
    const prevBlock = await fetchPreviousChapters()
    if (prevBlock) system = `${system}\n\n${prevBlock}`
    if (content.trim()) system = `${system}\n\n【当前章节正文】\n${content}`
    if (carryTimeline) {
      const timelineBlock = formatTimelineBlock(timelineEvents ?? [])
      if (timelineBlock) system = `${system}\n\n${timelineBlock}`
    }
    return system
  }

  /**
   * Assemble the message array from the CURRENT selections and show it as
   * JSON (with per-message source labels) — no send needed. Mirrors
   * handleSend's construction except knowledge/web retrieval, which costs an
   * embedding call and only happens on a real send. Editable: the save button
   * sends the edited array verbatim, once.
   */
  const openAssemblyPreview = async () => {
    const finalUser = draft.trim() || t('novels.st_assets.assembly_placeholder')
    const system = await buildSystemBlock()

    const replayed =
      historyRounds === ROUNDS_ALL ? history : historyRounds === 0 ? [] : history.slice(-historyRounds * 2)
    const useStAssets = presetId !== NONE || worldbookId !== NONE || entityIds.length > 0
    let preview: Array<{ role: string; source: string; content: string }>
    const notices: Array<{ text: string; tone?: 'info' | 'warn' }> = []
    if (useStAssets) {
      const assembled = assembleSession({
        presetJson: presetId !== NONE ? presetDetail?.json : undefined,
        cardJson,
        worldbookEntries: worldbookId !== NONE ? worldbookDetail?.entries : undefined,
        characterId: orderCharacterId,
        history: [...replayed, { role: 'user', content: finalUser }]
      })
      preview = assembled.messages.map((message) => ({
        role: message.role,
        source: message.source,
        content: message.content
      }))
      // Zero-hit worldbook fallback: keyword scan activated nothing, so append
      // the enabled entries to the writing context (same as the timeline).
      let contextBlock = system
      if (worldbookId !== NONE && assembled.report.activatedWorldInfo.length === 0) {
        const fallback = formatWorldbookBlock(worldbookDetail?.entries ?? [])
        if (fallback) {
          contextBlock = `${contextBlock}\n\n${fallback}`
          notices.push({ text: t('novels.st_assets.worldbook_fallback') })
        }
      }
      preview.splice(preview.length - 1, 0, { role: 'system', source: 'writing-context', content: contextBlock })
      notices.push({
        text: t('novels.st_assets.preview_stats', {
          messages: preview.length,
          included: assembled.report.includedPrompts.length,
          world: assembled.report.activatedWorldInfo.length,
          worldTotal: worldbookId !== NONE ? (worldbookDetail?.entries ?? []).length : 0
        })
      })
      for (const warning of assembled.warnings) {
        notices.push({ text: warning.message, tone: 'warn' })
      }
    } else {
      preview = [
        { role: 'system', source: 'writing-context', content: system },
        ...replayed.map((message) => ({ ...message, source: 'chatHistory' })),
        { role: 'user', source: 'chatHistory', content: finalUser }
      ]
    }
    if (preview.at(-1)?.role === 'assistant') {
      notices.push({ text: t('novels.st_assets.warn_trailing_assistant'), tone: 'warn' })
    }
    setJsonDialogNotices(notices)
    setJsonDialogData(preview)
    setJsonDialog({ kind: 'assembled', title: t('novels.st_assets.assembly_preview') })
  }

  /** Stream `messages` verbatim; `displayUser` is what shows as your turn. */
  const dispatchMessages = async (messages: SentMessage[], displayUser: string) => {
    setHistory((prev) => [...prev, { role: 'user', content: displayUser }])
    setStreaming('')
    setIsStreaming(true)
    const controller = new AbortController()
    abortRef.current = controller
    setLastSent(messages)
    try {
      const final = await streamNovelCompletion(modelId, messages, (acc) => setStreaming(acc), controller.signal)
      setHistory((prev) => [...prev, { role: 'assistant', content: final }])
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') {
        window.toast.error(formatErrorMessageWithPrefix(error, t('novels.write.ai_failed')))
      } else if (streaming.trim()) {
        setHistory((prev) => [...prev, { role: 'assistant', content: streaming }])
      }
    } finally {
      setIsStreaming(false)
      setStreaming('')
      abortRef.current = null
    }
  }

  /** "以此发送": validate the edited preview array and stream it verbatim (one-shot). */
  const sendEditedPreview = async (json: unknown) => {
    if (isStreaming || modelId === '') throw new Error(t('novels.st_assets.send_as_is_blocked'))
    if (!Array.isArray(json)) throw new Error(t('novels.st_assets.send_as_is_invalid'))
    const messages: SentMessage[] = json.map((item) => {
      const record = item as Record<string, unknown>
      const role = record?.role
      const messageContent = record?.content
      if ((role !== 'system' && role !== 'user' && role !== 'assistant') || typeof messageContent !== 'string') {
        throw new Error(t('novels.st_assets.send_as_is_invalid'))
      }
      return { role, content: messageContent }
    })
    if (messages.length === 0) throw new Error(t('novels.st_assets.send_as_is_invalid'))
    const lastUser = [...messages].reverse().find((message) => message.role === 'user')
    setDraft('')
    void dispatchMessages(messages, lastUser?.content ?? t('novels.st_assets.assembly_placeholder'))
  }

  const handleSend = async () => {
    if (modelId === '' || draft.trim() === '' || isStreaming) return
    const instruction = draft.trim()
    // Capture pre-send history for the request; dispatch appends display rows.
    const historyBefore = history
    setDraft('')

    // Writing-oriented prompt: editable header + previous chapters + current
    // chapter text + optional timeline, then knowledge/web reference.
    let system = await buildSystemBlock()
    const baseId = knowledgeBaseId === NO_KNOWLEDGE_BASE ? undefined : knowledgeBaseId
    if (baseId || webEnabled) {
      const sources = await retrieveReferences({ baseId, webEnabled, query: instruction })
      const referenceBlock = buildReferenceBlock(referenceMode, sources)
      if (referenceBlock) system = `${system}\n\n${referenceBlock}`
    }

    const replayed =
      historyRounds === ROUNDS_ALL ? historyBefore : historyRounds === 0 ? [] : historyBefore.slice(-historyRounds * 2)

    // With ST assets selected, the M4 engine assembles preset / worldbook /
    // character card scaffolding around the conversation; the writing context
    // rides as an extra system turn right before the final user message.
    const useStAssets = presetId !== NONE || worldbookId !== NONE || entityIds.length > 0
    let messages: SentMessage[]
    if (useStAssets) {
      const assembled = assembleSession({
        presetJson: presetId !== NONE ? presetDetail?.json : undefined,
        cardJson,
        worldbookEntries: worldbookId !== NONE ? worldbookDetail?.entries : undefined,
        characterId: orderCharacterId,
        history: [...replayed, { role: 'user', content: instruction }]
      })
      messages = toCompletionMessages(assembled.messages)
      // Zero-hit worldbook fallback — mirror of the assembly preview's rule.
      if (worldbookId !== NONE && assembled.report.activatedWorldInfo.length === 0) {
        const fallback = formatWorldbookBlock(worldbookDetail?.entries ?? [])
        if (fallback) system = `${system}\n\n${fallback}`
      }
      messages.splice(messages.length - 1, 0, { role: 'system', content: system })
    } else {
      messages = [{ role: 'system', content: system }, ...replayed, { role: 'user', content: instruction }]
    }
    await dispatchMessages(messages, instruction)
  }

  const adoptToEditor = (text: string) => {
    setContent((prev) => (prev.trim() ? `${prev}\n\n${text}` : text))
    setDirty(true)
  }

  if (chapter === undefined && chapters === undefined) {
    return <div className="h-full" />
  }

  return (
    <div className="flex h-full">
      {/* Left: chapter nav */}
      <aside className="flex w-56 shrink-0 flex-col border-border border-r">
        <button
          type="button"
          onClick={() => navigate({ to: '/app/novels/$novelId', params: { novelId } })}
          className="flex items-center gap-1 px-4 py-3 text-muted-foreground text-sm transition-colors hover:text-foreground">
          <ChevronLeft size={16} />
          {t('novels.write.back')}
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto px-2">
          {(chapters ?? []).map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() =>
                navigate({ to: '/app/novels/write/$novelId/$chapterId', params: { novelId, chapterId: item.id } })
              }
              className={`flex w-full flex-col rounded-md px-3 py-2 text-left transition-colors hover:bg-accent/50 ${
                item.id === chapterId ? 'bg-accent' : ''
              }`}>
              <span className="truncate text-sm">
                {index + 1}. {item.title}
              </span>
              <span className="text-muted-foreground text-xs">
                {t('novels.chapters.word_count', { count: item.wordCount })}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <ResizablePanelGroup direction="horizontal" className="min-w-0 flex-1">
        {/* Center: editor */}
        {/* react-resizable-panels v4: bare numbers mean PIXELS — sizes must be
            percentage strings, or the AI panel gets capped at a few px wide. */}
        <ResizablePanel defaultSize="65%" minSize="35%">
          <div className="flex h-full min-w-0 flex-col">
            <div className="flex shrink-0 items-center gap-2 px-6 py-3">
              <Input
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value)
                  setDirty(true)
                }}
                className="flex-1 font-medium"
              />
              <Button variant="emphasis" size="sm" loading={isSaving} disabled={!dirty} onClick={handleSave}>
                <Save size={14} />
                {t('novels.write.save')}
              </Button>
            </div>
            <textarea
              value={content}
              onChange={(event) => {
                setContent(event.target.value)
                setDirty(true)
              }}
              placeholder={t('novels.write.content_placeholder')}
              className="min-h-0 flex-1 resize-none bg-transparent px-6 pb-6 text-sm leading-relaxed outline-none"
            />
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Right: AI chat */}
        <ResizablePanel defaultSize="35%" minSize="22%" maxSize="60%">
          <div className="flex h-full flex-col">
            <div className="flex shrink-0 flex-col gap-2 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{t('novels.write.ai_panel')}</span>
                <Select value={modelId} onValueChange={setModelId}>
                  <SelectTrigger size="sm" className="ml-auto w-44">
                    <SelectValue placeholder={t('novels.roleplay.model_placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Select value={knowledgeBaseId} onValueChange={setKnowledgeBaseId}>
                  <SelectTrigger size="sm" className="flex-1">
                    <SelectValue placeholder={t('novels.reference.base_placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_KNOWLEDGE_BASE}>{t('novels.reference.base_none')}</SelectItem>
                    {readyBases.map((base) => (
                      <SelectItem key={base.id} value={base.id}>
                        {base.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={referenceMode} onValueChange={(value) => setReferenceMode(value as ReferenceMode)}>
                  <SelectTrigger size="sm" className="w-28" disabled={knowledgeBaseId === NO_KNOWLEDGE_BASE}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REFERENCE_MODES.map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {t(`novels.reference.mode_${mode}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <input
                ref={presetFileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void importAssetFile(file, 'preset')
                  event.target.value = ''
                }}
              />
              <input
                ref={worldbookFileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void importAssetFile(file, 'worldbook')
                  event.target.value = ''
                }}
              />
              <div className="flex items-center gap-1">
                <Select value={presetId} onValueChange={setPresetId}>
                  <SelectTrigger size="sm" className="flex-1">
                    <SelectValue placeholder={t('novels.roleplay.preset')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t('novels.st_assets.preset_none')}</SelectItem>
                    {(presets ?? []).map((preset) => (
                      <SelectItem key={preset.id} value={preset.id}>
                        {preset.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={t('novels.st_assets.import_preset')}
                  onClick={() => presetFileRef.current?.click()}>
                  <Import size={14} />
                </Button>
                {presetId !== NONE && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t('novels.st_assets.view_json')}
                      onClick={() => void openJsonDialog('preset')}>
                      <FileJson size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t('novels.st_assets.entries_toggle')}
                      onClick={() => setEntriesDialogOpen(true)}>
                      <ListChecks size={14} />
                    </Button>
                  </>
                )}
              </div>
              {presetId !== NONE && orderOptions.length > 1 && (
                <Select value={orderCharacterId} onValueChange={setOrderCharacterId}>
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {orderOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {t('novels.st_assets.order_option', {
                          id: option.id,
                          total: option.total,
                          enabled: option.enabled
                        })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <div className="flex items-center gap-1">
                <Select value={worldbookId} onValueChange={setWorldbookId}>
                  <SelectTrigger size="sm" className="flex-1">
                    <SelectValue placeholder={t('novels.roleplay.worldbook')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t('novels.st_assets.worldbook_none')}</SelectItem>
                    {(worldbooks ?? []).map((worldbook) => (
                      <SelectItem key={worldbook.id} value={worldbook.id}>
                        {worldbook.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={t('novels.st_assets.import_worldbook')}
                  onClick={() => worldbookFileRef.current?.click()}>
                  <Import size={14} />
                </Button>
                {worldbookId !== NONE && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title={t('novels.st_assets.view_json')}
                    onClick={() => void openJsonDialog('worldbook')}>
                    <FileJson size={14} />
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="flex-1 justify-between font-normal">
                      <span className="truncate">
                        {selectedEntities.length === 0
                          ? t('novels.roleplay.character_none')
                          : selectedEntities.length === 1
                            ? selectedEntities[0].name
                            : t('novels.st_assets.characters_selected', { count: selectedEntities.length })}
                      </span>
                      <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="max-h-64 w-56 overflow-y-auto p-2">
                    {characters.length === 0 ? (
                      <span className="px-2 text-muted-foreground text-xs">{t('novels.roleplay.character_empty')}</span>
                    ) : (
                      characters.map((character) => (
                        <label
                          key={character.id}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50">
                          <Checkbox
                            checked={entityIds.includes(character.id)}
                            onCheckedChange={(checked) =>
                              setEntityIds((prev) =>
                                checked === true ? [...prev, character.id] : prev.filter((id) => id !== character.id)
                              )
                            }
                          />
                          <span className="truncate">{character.name}</span>
                        </label>
                      ))
                    )}
                  </PopoverContent>
                </Popover>
                {entityIds.length > 0 && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title={t('novels.st_assets.view_json')}
                    onClick={() => void openJsonDialog('card')}>
                    <FileJson size={14} />
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Select value={String(prevChapterCount)} onValueChange={(value) => setPrevChapterCount(Number(value))}>
                  <SelectTrigger size="sm" className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PREV_CHAPTER_OPTIONS.map((count) => (
                      <SelectItem key={count} value={String(count)}>
                        {count === 0
                          ? t('novels.write.prev_chapters_none')
                          : t('novels.write.prev_chapters', { count })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={String(historyRounds)} onValueChange={(value) => setHistoryRounds(Number(value))}>
                  <SelectTrigger size="sm" className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROUNDS_OPTIONS.map((rounds) => (
                      <SelectItem key={rounds} value={String(rounds)}>
                        {rounds === ROUNDS_ALL
                          ? t('novels.write.rounds_all')
                          : t('novels.write.rounds', { count: rounds })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-muted-foreground text-xs">
                  <Switch checked={webEnabled} onCheckedChange={setWebEnabled} />
                  {t('novels.reference.web_search')}
                </label>
                <label className="flex items-center gap-2 text-muted-foreground text-xs">
                  <Switch checked={carryTimeline} onCheckedChange={setCarryTimeline} />
                  {t('novels.write.carry_timeline')}
                </label>
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title={t('novels.write.edit_prompt')}
                    onClick={() => setPromptDialogOpen(true)}>
                    <PenLine size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title={t('novels.write.view_prompt')}
                    onClick={() => setShowPrompt((v) => !v)}>
                    {showPrompt ? <EyeOff size={14} /> : <Eye size={14} />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title={t('novels.st_assets.assembly_preview')}
                    onClick={() => void openAssemblyPreview()}>
                    <Braces size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title={t('novels.write.clear_chat')}
                    disabled={history.length === 0 && !isStreaming}
                    onClick={() => {
                      setHistory([])
                      setLastSent(null)
                    }}>
                    <Eraser size={14} />
                  </Button>
                </div>
              </div>
            </div>

            {showPrompt && (
              <div className="mx-4 mb-2 max-h-48 shrink-0 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3">
                <p className="mb-1 text-muted-foreground text-xs">{t('novels.write.prompt_hint')}</p>
                {lastSent === null ? (
                  <p className="text-muted-foreground text-xs">{t('novels.write.prompt_empty')}</p>
                ) : (
                  lastSent.map((message, index) => (
                    <div key={index} className="border-border/50 border-b py-1 last:border-0">
                      <span className="text-[10px] text-muted-foreground">{message.role}</span>
                      <p className="whitespace-pre-wrap text-xs">{message.content}</p>
                    </div>
                  ))
                )}
              </div>
            )}

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-3">
              {history.length === 0 && !isStreaming ? (
                <div className="flex h-full items-center justify-center">
                  <EmptyState icon={BookOpen} title={t('novels.write.ai_hint')} compact />
                </div>
              ) : (
                <>
                  {history.map((message, index) => (
                    <div key={index} className="flex flex-col gap-1">
                      <div
                        className={
                          message.role === 'user'
                            ? 'self-end rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-primary-foreground'
                            : 'self-start rounded-2xl rounded-bl-sm bg-accent px-3 py-2'
                        }>
                        <p className="whitespace-pre-wrap text-sm">{message.content}</p>
                      </div>
                      {message.role === 'assistant' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="self-start"
                          onClick={() => adoptToEditor(message.content)}>
                          {t('novels.write.adopt')}
                        </Button>
                      )}
                    </div>
                  ))}
                  {isStreaming && (
                    <div className="self-start rounded-2xl rounded-bl-sm bg-accent px-3 py-2">
                      <p className="whitespace-pre-wrap text-sm">{streaming || '…'}</p>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="flex shrink-0 items-end gap-2 px-4 pb-4">
              <Textarea.Input
                value={draft}
                onValueChange={setDraft}
                rows={2}
                className="flex-1"
                placeholder={t('novels.write.instruction_placeholder')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault()
                    void handleSend()
                  }
                }}
              />
              {isStreaming ? (
                <Button variant="outline" size="icon" onClick={() => abortRef.current?.abort()}>
                  <Square size={14} />
                </Button>
              ) : (
                <Button
                  variant="emphasis"
                  size="icon"
                  disabled={modelId === '' || draft.trim() === ''}
                  onClick={handleSend}>
                  <Send size={14} />
                </Button>
              )}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      <AssetJsonDialog
        open={jsonDialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            setJsonDialog(null)
            setJsonDialogNotices([])
          }
        }}
        title={jsonDialog?.title ?? ''}
        json={jsonDialogData}
        notices={jsonDialog?.kind === 'assembled' ? jsonDialogNotices : undefined}
        saveLabel={jsonDialog?.kind === 'assembled' ? t('novels.st_assets.send_as_is') : undefined}
        onSave={
          jsonDialog?.kind === 'assembled'
            ? sendEditedPreview
            : jsonDialog && (jsonDialog.kind === 'preset' || jsonDialog.kind === 'worldbook')
              ? handleJsonSave
              : undefined
        }
      />

      <PresetEntryToggleDialog
        open={entriesDialogOpen}
        onOpenChange={setEntriesDialogOpen}
        presetJson={presetDetail?.json as Record<string, unknown> | undefined}
        characterId={orderCharacterId}
        onSave={async (json) => {
          await patchPreset({ params: { presetId }, body: { json } })
          window.toast.success(t('novels.st_assets.entries_saved'))
        }}
      />

      <Dialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen}>
        <DialogContent size="default">
          <DialogHeader>
            <DialogTitle>{t('novels.write.edit_prompt')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Label>{t('novels.write.edit_prompt_hint')}</Label>
            <Textarea.Input value={systemPrompt} onValueChange={setSystemPrompt} rows={8} />
            <div className="flex justify-between gap-2">
              <Button variant="outline" size="sm" onClick={() => setSystemPrompt(t('novels.write.system_prompt'))}>
                {t('novels.write.prompt_reset')}
              </Button>
              <Button variant="emphasis" size="sm" onClick={() => setPromptDialogOpen(false)}>
                {t('common.confirm')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default WriteWorkbenchPage
