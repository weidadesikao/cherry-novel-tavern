/**
 * M10 write workbench — the chat-pipeline graft.
 *
 * Layout matches the M9 workbench (chapter nav / editor / AI panel), but the
 * AI panel is the REAL chat stack: a per-chapter `novel-…` topic rendered by
 * V2ChatContent (persistence, edit/delete, branching, @multi-model,
 * attachments all inherited). The ST-asset toolbar no longer assembles in the
 * renderer — it persists selections into the session's config row, and the
 * main-side NovelChatContextProvider assembles on every send. The `{}` preview
 * asks main for a dry-run of exactly that assembly.
 *
 * The config toolbar lives in a collapsible, independently-scrolling section
 * ABOVE the chat (not sharing a flex column without height bounds) — an
 * earlier layout let the toolbar's content push the chat area (and its
 * Inputbar, including the @mention button) outside the viewport entirely.
 *
 * Note: main reads the SAVED chapter body — save before sending if the latest
 * editor text should be visible to the model.
 */

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { ModelSelector } from '@renderer/components/ModelSelector'
import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledgeBase'
import V2ChatContent from '@renderer/pages/home/V2ChatContent'
import type { Topic } from '@renderer/types'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { Model as SharedModel } from '@shared/data/types/model'
import { NOVEL_HISTORY_ROUNDS_ALL, type NovelChatConfig, type NovelChatSession } from '@shared/data/types/novel'
import { isNonChatModel, isWebSearchModel } from '@shared/utils/model'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Braces, ChevronDown, ChevronLeft, FileJson, Import, ListChecks, PenLine, Save, Settings2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import AssetJsonDialog from '../../novels/components/AssetJsonDialog'
import PresetEntryToggleDialog from '../../novels/components/PresetEntryToggleDialog'
import { DEFAULT_REFERENCE_MODE, REFERENCE_MODES, type ReferenceMode } from '../../novels/novelReference'

const NONE = '__none__'
const NO_KNOWLEDGE_BASE = 'none'
const PREV_CHAPTER_OPTIONS = [0, 1, 2, 3, 5] as const
const ROUNDS_OPTIONS = [0, 2, 4, 8, 16, NOVEL_HISTORY_ROUNDS_ALL] as const
const noop = () => {}
const modelFilter = (m: SharedModel) => !isNonChatModel(m)

const WriteWorkbenchM10Page = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { novelId, chapterId } = useParams({ strict: false }) as { novelId: string; chapterId: string }

  // --- Chapter editor (copied from the M9 workbench) ---
  const { data: chapters } = useQuery('/novels/:novelId/chapters', { params: { novelId } })
  const { data: chapter } = useQuery('/novels/:novelId/chapters/:chapterId', {
    params: { novelId, chapterId }
  })
  const { trigger: updateChapter, isLoading: isSaving } = useMutation('PATCH', '/novels/:novelId/chapters/:chapterId', {
    refresh: ({ args }) => [`/novels/${args!.params.novelId}/chapters`]
  })

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const loadedChapterId = useRef<string | null>(null)

  useEffect(() => {
    if (chapter && loadedChapterId.current !== chapter.id) {
      setTitle(chapter.title)
      setContent(chapter.content)
      setDirty(false)
      loadedChapterId.current = chapter.id
    }
  }, [chapter])

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

  // --- Chat session bootstrap: find-or-create the chapter's novel topic ---
  const [session, setSession] = useState<NovelChatSession | null>(null)
  const sessionTopicRef = useRef<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setSession(null)
    sessionTopicRef.current = null
    ;(async () => {
      try {
        // POST is idempotent per chapter AND backfills the dedicated
        // assistant on legacy sessions — always create, never plain GET.
        // (Cast: the template path matches several endpoint patterns in the
        // type map; narrow to the session shape this URL actually returns.)
        const found = (await dataApiService.post(`/novels/${novelId}/chat-sessions`, {
          body: { chapterId }
        })) as NovelChatSession
        if (!cancelled) {
          sessionTopicRef.current = found.topicId
          setSession(found)
        }
      } catch (error) {
        if (!cancelled) {
          window.toast.error(formatErrorMessageWithPrefix(error, t('novels.m10.session_failed')))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [novelId, chapterId, t])

  const config: NovelChatConfig | null = session?.config ?? null

  /** Optimistic local update + persisted PATCH; stale responses are dropped. */
  const patchConfig = (patch: Partial<NovelChatConfig>) => {
    if (!session) return
    const next = { ...session.config, ...patch }
    const topicId = session.topicId
    setSession({ ...session, config: next })
    void dataApiService
      .patch(`/novels/${novelId}/chat-sessions/${topicId}`, { body: { config: next } })
      .then((updated) => {
        if (sessionTopicRef.current === topicId) setSession(updated as NovelChatSession)
      })
      .catch((error) => {
        window.toast.error(formatErrorMessageWithPrefix(error, t('novels.m10.config_save_failed')))
      })
  }

  // --- ST asset sources (same queries as M9) ---
  const { data: presets, refetch: refetchPresets } = useQuery('/st-presets')
  const { data: worldbooks, refetch: refetchWorldbooks } = useQuery('/worldbooks')
  const { data: entities } = useQuery('/novels/:novelId/entities', { params: { novelId } })
  const { bases: knowledgeBases } = useKnowledgeBases()
  const readyBases = knowledgeBases.filter((base) => base.status === 'completed')
  const characters = useMemo(() => (entities ?? []).filter((entity) => entity.type === 'character'), [entities])
  const presetId = config?.presetId ?? NONE
  const worldbookId = config?.worldbookId ?? NONE
  const { data: presetDetail } = useQuery('/st-presets/:presetId', {
    params: { presetId },
    enabled: presetId !== NONE
  })

  const { trigger: importPreset } = useMutation('POST', '/st-presets', { refresh: ['/st-presets'] })
  const { trigger: importWorldbook } = useMutation('POST', '/worldbooks/import:st', { refresh: ['/worldbooks'] })
  const { trigger: patchPreset } = useMutation('PATCH', '/st-presets/:presetId', {
    refresh: ({ args }) => ['/st-presets', `/st-presets/${args!.params.presetId}`]
  })

  const presetFileRef = useRef<HTMLInputElement>(null)
  const worldbookFileRef = useRef<HTMLInputElement>(null)
  const [entriesDialogOpen, setEntriesDialogOpen] = useState(false)
  const [promptDialogOpen, setPromptDialogOpen] = useState(false)
  const [promptDraft, setPromptDraft] = useState('')

  // Asset JSON viewer/editor (preset + worldbook) — same dialog M9 uses.
  const [jsonDialog, setJsonDialog] = useState<{ kind: 'preset' | 'worldbook'; title: string } | null>(null)
  const [jsonDialogData, setJsonDialogData] = useState<unknown>(null)
  const openJsonDialog = async (kind: 'preset' | 'worldbook') => {
    try {
      if (kind === 'preset' && presetId !== NONE) {
        setJsonDialogData(presetDetail?.json ?? {})
        setJsonDialog({ kind, title: (presets ?? []).find((p) => p.id === presetId)?.name ?? '' })
      } else if (kind === 'worldbook' && worldbookId !== NONE) {
        const exported = await dataApiService.get(`/worldbooks/${worldbookId}/export:st`)
        setJsonDialogData(exported)
        setJsonDialog({ kind, title: (worldbooks ?? []).find((w) => w.id === worldbookId)?.name ?? '' })
      }
    } catch (error) {
      window.toast.error(formatErrorMessageWithPrefix(error, t('novels.st_assets.load_failed')))
    }
  }
  const handleJsonSave = async (json: unknown) => {
    if (!jsonDialog) return
    if (jsonDialog.kind === 'preset') {
      await patchPreset({ params: { presetId }, body: { json } })
    } else {
      const name = (worldbooks ?? []).find((w) => w.id === worldbookId)?.name ?? jsonDialog.title
      await importWorldbook({ body: { name, json, worldbookId } })
      void refetchWorldbooks()
    }
    window.toast.success(t('novels.st_assets.json_saved'))
  }

  // The preset's available prompt_order lists (same parsing as M9).
  const orderOptions = useMemo(() => {
    const orders = ((presetDetail?.json as Record<string, unknown> | undefined)?.prompt_order ?? []) as Array<
      Record<string, unknown>
    >
    return orders.map((order) => {
      const orderEntries = (order.order as Array<Record<string, unknown>> | undefined) ?? []
      return {
        id: String(order.character_id),
        total: orderEntries.length,
        enabled: orderEntries.filter((entry) => entry.enabled === true).length
      }
    })
  }, [presetDetail])

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

  // --- Assembly preview: main-side dry run of the next send ---
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewData, setPreviewData] = useState<unknown>(null)
  const [previewNotices, setPreviewNotices] = useState<Array<{ text: string; tone?: 'info' | 'warn' }>>([])
  const openPreview = async () => {
    if (!session) return
    try {
      const result = await dataApiService.get(`/novels/${novelId}/chat-sessions/${session.topicId}/preview`)
      const notices: Array<{ text: string; tone?: 'info' | 'warn' }> = [
        {
          text: t('novels.st_assets.preview_stats', {
            messages: result.messages.length,
            included: result.stats.included,
            world: result.stats.world,
            worldTotal: result.stats.worldTotal
          })
        },
        ...result.warnings.map((warning) => ({ text: warning, tone: 'warn' as const }))
      ]
      setPreviewNotices(notices)
      setPreviewData(result.messages)
      setPreviewOpen(true)
    } catch (error) {
      window.toast.error(formatErrorMessageWithPrefix(error, t('novels.st_assets.load_failed')))
    }
  }

  // --- Chat topic: minimal renderer Topic over the session's real DB row.
  // The session's dedicated assistant unlocks the Inputbar capability toolbar
  // (attachments / thinking / web search / knowledge / @mentions). ---
  const topic = useMemo<Topic | null>(() => {
    if (!session) return null
    return {
      id: session.topicId,
      assistantId: session.assistantId,
      name: '',
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messages: [],
      pinned: false,
      isNameManuallyEdited: true
    }
  }, [session])

  // Per-session model: lives on the dedicated novel assistant (same pattern
  // as the chat navbar's TopicContent), so it never leaks into other chats.
  const { assistant, model: sessionModel, setModel } = useAssistant(session?.assistantId)
  const handleModelSelect = (model: SharedModel | undefined) => {
    if (!model || !assistant) return
    const enabledWebSearch = isWebSearchModel(model)
    void setModel(model, { enableWebSearch: enabledWebSearch && assistant.settings.enableWebSearch })
  }

  const selectedCharacters = useMemo(
    () => characters.filter((character) => (config?.entityIds ?? []).includes(character.id)),
    [characters, config]
  )

  if (chapter === undefined && chapters === undefined) {
    return <div className="h-full" />
  }

  return (
    <div className="flex h-full">
      {/* Left: chapter nav */}
      <aside className="flex w-56 shrink-0 flex-col border-border border-r">
        <button
          type="button"
          onClick={() => navigate({ to: '/app/novels-m10/$novelId', params: { novelId } })}
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
                navigate({ to: '/app/novels-m10/write/$novelId/$chapterId', params: { novelId, chapterId: item.id } })
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
        <ResizablePanel defaultSize="60%" minSize="30%">
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

        {/* Right: grafted chat pipeline. `min-h-0` on this flex column is what
            lets the collapsible config section and the chat area share height
            without either one pushing the other outside the viewport. */}
        <ResizablePanel defaultSize="40%" minSize="25%" maxSize="65%">
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center gap-1 border-border border-b px-3 py-2">
              <span className="shrink-0 font-medium text-sm" title={t('novels.m10.save_hint')}>
                {t('novels.m10.ai_panel')}
              </span>
              <ModelSelector
                multiple={false}
                value={sessionModel}
                onSelect={handleModelSelect}
                filter={modelFilter}
                trigger={
                  <Button variant="ghost" size="sm" className="h-7 min-w-0 gap-1.5 rounded-full px-2 text-xs">
                    <ModelAvatar model={sessionModel} size={16} />
                    <span className="max-w-32 truncate">
                      {sessionModel ? sessionModel.name : t('button.select_model')}
                    </span>
                    <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
                  </Button>
                }
              />
              <div className="ml-auto flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={t('novels.write.edit_prompt')}
                  onClick={() => {
                    setPromptDraft(config?.systemPrompt ?? t('novels.write.system_prompt'))
                    setPromptDialogOpen(true)
                  }}>
                  <PenLine size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={t('novels.st_assets.assembly_preview')}
                  disabled={!session}
                  onClick={() => void openPreview()}>
                  <Braces size={14} />
                </Button>
              </div>
            </div>

            {/* Collapsible ST-asset + context config — independently scrolls
                (max-h-[45vh]) so it can never push the chat area/Inputbar
                out of the viewport, unlike an uncapped flex column. */}
            <Accordion type="single" collapsible className="shrink-0 border-border border-b px-3">
              <AccordionItem value="config" className="border-0">
                <AccordionTrigger className="py-2 text-xs [&>svg]:size-3.5">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Settings2 size={13} />
                    {t('novels.m10.config_toggle')}
                  </span>
                </AccordionTrigger>
                <AccordionContent className="max-h-[45vh] overflow-y-auto pb-3">
                  <div className="flex flex-col gap-2">
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
                      <Select
                        value={presetId}
                        onValueChange={(value) => patchConfig({ presetId: value === NONE ? undefined : value })}>
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
                      <Select
                        value={config?.orderCharacterId ?? '100001'}
                        onValueChange={(value) => patchConfig({ orderCharacterId: value })}>
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
                      <Select
                        value={worldbookId}
                        onValueChange={(value) => patchConfig({ worldbookId: value === NONE ? undefined : value })}>
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

                    <div className="flex items-center gap-2">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="flex-1 justify-between font-normal">
                            <span className="truncate">
                              {selectedCharacters.length === 0
                                ? t('novels.roleplay.character_none')
                                : selectedCharacters.length === 1
                                  ? selectedCharacters[0].name
                                  : t('novels.st_assets.characters_selected', { count: selectedCharacters.length })}
                            </span>
                            <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="max-h-64 w-56 overflow-y-auto p-2">
                          {characters.length === 0 ? (
                            <span className="px-2 text-muted-foreground text-xs">
                              {t('novels.roleplay.character_empty')}
                            </span>
                          ) : (
                            characters.map((character) => (
                              <label
                                key={character.id}
                                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50">
                                <Checkbox
                                  checked={(config?.entityIds ?? []).includes(character.id)}
                                  onCheckedChange={(checked) => {
                                    const current = config?.entityIds ?? []
                                    patchConfig({
                                      entityIds:
                                        checked === true
                                          ? [...current, character.id]
                                          : current.filter((id) => id !== character.id)
                                    })
                                  }}
                                />
                                <span className="truncate">{character.name}</span>
                              </label>
                            ))
                          )}
                        </PopoverContent>
                      </Popover>
                      <Select
                        value={String(config?.prevChapterCount ?? 0)}
                        onValueChange={(value) => patchConfig({ prevChapterCount: Number(value) })}>
                        <SelectTrigger size="sm" className="w-28">
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
                    </div>

                    <div className="flex items-center gap-2">
                      <Select
                        value={String(config?.historyRounds ?? NOVEL_HISTORY_ROUNDS_ALL)}
                        onValueChange={(value) => patchConfig({ historyRounds: Number(value) })}>
                        <SelectTrigger size="sm" className="flex-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROUNDS_OPTIONS.map((rounds) => (
                            <SelectItem key={rounds} value={String(rounds)}>
                              {rounds === NOVEL_HISTORY_ROUNDS_ALL
                                ? t('novels.write.rounds_all')
                                : t('novels.write.rounds', { count: rounds })}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <label className="flex items-center gap-1.5 text-muted-foreground text-xs">
                        <Switch
                          checked={config?.carryTimeline ?? false}
                          onCheckedChange={(checked) => patchConfig({ carryTimeline: checked })}
                        />
                        {t('novels.write.carry_timeline')}
                      </label>
                    </div>

                    <div className="flex items-center gap-1">
                      <Select
                        value={config?.knowledgeBaseId ?? NO_KNOWLEDGE_BASE}
                        onValueChange={(value) =>
                          patchConfig({ knowledgeBaseId: value === NO_KNOWLEDGE_BASE ? undefined : value })
                        }>
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
                      <Select
                        value={config?.referenceMode ?? DEFAULT_REFERENCE_MODE}
                        onValueChange={(value) => patchConfig({ referenceMode: value as ReferenceMode })}>
                        <SelectTrigger size="sm" className="w-24" disabled={!config?.knowledgeBaseId}>
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
                      <label className="flex shrink-0 items-center gap-1.5 text-muted-foreground text-xs">
                        <Switch
                          checked={config?.webSearchEnabled ?? false}
                          onCheckedChange={(checked) => patchConfig({ webSearchEnabled: checked })}
                        />
                        {t('novels.reference.web_search')}
                      </label>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            {/* The grafted chat: real topic + real message tree */}
            <div className="flex min-h-0 flex-1 flex-col">
              {topic ? (
                <QuickPanelProvider>
                  <V2ChatContent key={topic.id} topic={topic} setActiveTopic={noop} />
                </QuickPanelProvider>
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
                  {t('common.loading')}
                </div>
              )}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      <AssetJsonDialog
        open={previewOpen}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewOpen(false)
            setPreviewNotices([])
          }
        }}
        title={t('novels.st_assets.assembly_preview')}
        json={previewData}
        notices={previewNotices}
      />

      <AssetJsonDialog
        open={jsonDialog !== null}
        onOpenChange={(open) => {
          if (!open) setJsonDialog(null)
        }}
        title={jsonDialog?.title ?? ''}
        json={jsonDialogData}
        onSave={handleJsonSave}
      />

      <PresetEntryToggleDialog
        open={entriesDialogOpen}
        onOpenChange={setEntriesDialogOpen}
        presetJson={presetDetail?.json as Record<string, unknown> | undefined}
        characterId={config?.orderCharacterId ?? '100001'}
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
            <Textarea.Input value={promptDraft} onValueChange={setPromptDraft} rows={8} />
            <div className="flex justify-between gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  patchConfig({ systemPrompt: undefined })
                  setPromptDialogOpen(false)
                }}>
                {t('novels.write.prompt_reset')}
              </Button>
              <Button
                variant="emphasis"
                size="sm"
                onClick={() => {
                  const trimmed = promptDraft.trim()
                  patchConfig({ systemPrompt: trimmed ? trimmed : undefined })
                  setPromptDialogOpen(false)
                }}>
                {t('common.confirm')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default WriteWorkbenchM10Page
