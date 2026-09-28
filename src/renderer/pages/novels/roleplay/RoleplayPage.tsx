import {
  Button,
  Label,
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
import { useModels } from '@renderer/hooks/useModel'
import { type NovelChatMessage, streamNovelCompletion, toCompletionMessages } from '@renderer/services/NovelChatService'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { Eye, EyeOff, FileJson, Import, Send, Square } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import AssetJsonDialog from '../components/AssetJsonDialog'
import {
  buildReferenceBlock,
  DEFAULT_REFERENCE_MODE,
  REFERENCE_MODES,
  type ReferenceMode,
  retrieveReferences
} from '../novelReference'
import { assembleSession, entityToCardJson, type RoleplayChatMessage } from './assembleSession'

const NONE = '__none__'
/** History rounds sentinel: include the whole conversation. */
const ROUNDS_ALL = -1
const ROUNDS_OPTIONS = [0, 2, 4, 8, 16, ROUNDS_ALL] as const

const RoleplayPage = () => {
  const { t } = useTranslation()

  const { models } = useModels({ enabled: true })
  const { data: presets, refetch: refetchPresets } = useQuery('/st-presets')
  const { data: worldbooks, refetch: refetchWorldbooks } = useQuery('/worldbooks')
  const { data: novels } = useQuery('/novels')
  const { bases: knowledgeBases } = useKnowledgeBases()
  const readyBases = knowledgeBases.filter((base) => base.status === 'completed')

  const [modelId, setModelId] = useState<string>('')
  const [presetId, setPresetId] = useState<string>(NONE)
  const [worldbookId, setWorldbookId] = useState<string>(NONE)
  const [novelId, setNovelId] = useState<string>(NONE)
  const [entityId, setEntityId] = useState<string>(NONE)
  const [persona, setPersona] = useState('')

  // Knowledge-base reference (PRD §5): retrieval pipeline unchanged; the mode
  // only reframes how retrieved excerpts are injected as an extra system turn.
  const [knowledgeBaseId, setKnowledgeBaseId] = useState<string>(NONE)
  const [referenceMode, setReferenceMode] = useState<ReferenceMode>(DEFAULT_REFERENCE_MODE)
  const [webEnabled, setWebEnabled] = useState(false)
  // How many conversation rounds are replayed into each request (all by default).
  const [historyRounds, setHistoryRounds] = useState(ROUNDS_ALL)

  // Character entities of the selected novel (filtered to characters).
  const { data: entities } = useQuery('/novels/:novelId/entities', {
    params: { novelId },
    enabled: novelId !== NONE
  })
  const characters = useMemo(() => (entities ?? []).filter((entity) => entity.type === 'character'), [entities])
  const selectedEntity = useMemo(() => characters.find((entity) => entity.id === entityId), [characters, entityId])

  const [history, setHistory] = useState<RoleplayChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [showPrompt, setShowPrompt] = useState(false)
  // The reference block actually injected on the last send (assembly preview
  // can't show it — retrieval happens at send time), keyed by its mode so the
  // prompt viewer makes the three modes' differences visible (M6 acceptance).
  const [lastReference, setLastReference] = useState<{ mode: string; block: string } | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Fetch the selected preset's verbatim JSON (only when one is chosen).
  const { data: presetDetail } = useQuery('/st-presets/:presetId', {
    params: { presetId },
    enabled: presetId !== NONE
  })
  // Fetch the selected worldbook's entries.
  const { data: worldbookDetail } = useQuery('/worldbooks/:worldbookId', {
    params: { worldbookId },
    enabled: worldbookId !== NONE
  })

  const cardJson = useMemo(() => (selectedEntity ? entityToCardJson(selectedEntity) : undefined), [selectedEntity])

  const buildAssembled = (nextHistory: RoleplayChatMessage[]) =>
    assembleSession({
      presetJson: presetId !== NONE ? presetDetail?.json : undefined,
      cardJson,
      worldbookEntries: worldbookId !== NONE ? worldbookDetail?.entries : undefined,
      persona: persona.trim() || undefined,
      history: nextHistory
    })

  const previewMessages = useMemo(
    () => buildAssembled(history).messages,
    [history, presetId, presetDetail, worldbookId, worldbookDetail, cardJson, persona]
  )

  const canSend = modelId !== '' && draft.trim() !== '' && !isStreaming

  const handleSend = async () => {
    if (!canSend) return
    const userMessage: RoleplayChatMessage = { role: 'user', content: draft.trim() }
    const nextHistory = [...history, userMessage]
    setHistory(nextHistory)
    setDraft('')
    setStreaming('')
    setIsStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      // Trim to the configured rounds, always keeping the just-sent user turn.
      const contextHistory = historyRounds === ROUNDS_ALL ? nextHistory : nextHistory.slice(-(historyRounds * 2 + 1))
      const assembled = buildAssembled(contextHistory)
      const messages: NovelChatMessage[] = toCompletionMessages(assembled.messages)

      // Knowledge-base reference: retrieve on the user's latest message, wrap in
      // the selected mode's template, and insert before the final user turn.
      const baseId = knowledgeBaseId === NONE ? undefined : knowledgeBaseId
      if (baseId || webEnabled) {
        const sources = await retrieveReferences({ baseId, webEnabled, query: userMessage.content })
        const referenceBlock = buildReferenceBlock(referenceMode, sources)
        if (referenceBlock) {
          messages.splice(messages.length - 1, 0, { role: 'system', content: referenceBlock })
        }
        setLastReference(referenceBlock ? { mode: referenceMode, block: referenceBlock } : null)
      } else {
        setLastReference(null)
      }

      const final = await streamNovelCompletion(modelId, messages, (acc) => setStreaming(acc), controller.signal)
      setHistory((prev) => [...prev, { role: 'assistant', content: final }])
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') {
        window.toast.error(formatErrorMessageWithPrefix(error, t('novels.roleplay.send_failed')))
      } else if (streaming.trim()) {
        // Keep whatever was streamed before the user stopped.
        setHistory((prev) => [...prev, { role: 'assistant', content: streaming }])
      }
    } finally {
      setIsStreaming(false)
      setStreaming('')
      abortRef.current = null
    }
  }

  const handleStop = () => abortRef.current?.abort()

  // ST asset import + JSON view/edit (mirrors the write workbench).
  const presetFileRef = useRef<HTMLInputElement>(null)
  const worldbookFileRef = useRef<HTMLInputElement>(null)
  const [jsonDialog, setJsonDialog] = useState<{ kind: 'preset' | 'worldbook'; title: string } | null>(null)
  const [jsonDialogData, setJsonDialogData] = useState<unknown>(null)
  const { trigger: importPreset } = useMutation('POST', '/st-presets', { refresh: ['/st-presets'] })
  const { trigger: importWorldbook } = useMutation('POST', '/worldbooks/import:st', { refresh: ['/worldbooks'] })
  const { trigger: patchPreset } = useMutation('PATCH', '/st-presets/:presetId', {
    refresh: ({ args }) => ['/st-presets', `/st-presets/${args!.params.presetId}`]
  })

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

  return (
    <div className="flex h-full">
      {/* Setup panel */}
      <aside className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-border border-r p-4">
        <h2 className="font-semibold text-sm">{t('novels.roleplay.setup')}</h2>

        <div className="flex flex-col gap-1.5">
          <Label>{t('novels.roleplay.model')}</Label>
          <Select value={modelId} onValueChange={setModelId}>
            <SelectTrigger size="sm" className="w-full">
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
        <div className="flex flex-col gap-1.5">
          <Label>{t('novels.roleplay.preset')}</Label>
          <div className="flex items-center gap-1">
            <Select value={presetId} onValueChange={setPresetId}>
              <SelectTrigger size="sm" className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('novels.roleplay.preset_default')}</SelectItem>
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
              <Button
                variant="ghost"
                size="icon-sm"
                title={t('novels.st_assets.view_json')}
                onClick={() => void openJsonDialog('preset')}>
                <FileJson size={14} />
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>{t('novels.roleplay.worldbook')}</Label>
          <div className="flex items-center gap-1">
            <Select value={worldbookId} onValueChange={setWorldbookId}>
              <SelectTrigger size="sm" className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('novels.roleplay.worldbook_none')}</SelectItem>
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
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>{t('novels.roleplay.novel')}</Label>
          <Select
            value={novelId}
            onValueChange={(value) => {
              setNovelId(value)
              setEntityId(NONE)
            }}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('novels.roleplay.novel_none')}</SelectItem>
              {(novels ?? []).map((novel) => (
                <SelectItem key={novel.id} value={novel.id}>
                  {novel.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>{t('novels.roleplay.character')}</Label>
          <Select value={entityId} onValueChange={setEntityId} disabled={novelId === NONE}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue placeholder={t('novels.roleplay.character_placeholder')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('novels.roleplay.character_none')}</SelectItem>
              {characters.map((entity) => (
                <SelectItem key={entity.id} value={entity.id}>
                  {entity.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {novelId !== NONE && characters.length === 0 && (
            <p className="text-muted-foreground text-xs">{t('novels.roleplay.character_empty')}</p>
          )}
        </div>

        {selectedEntity?.card.description && (
          <p className="line-clamp-4 rounded-md bg-muted/40 p-2 text-muted-foreground text-xs">
            {selectedEntity.card.description}
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <Label>{t('novels.roleplay.persona')}</Label>
          <Textarea.Input value={persona} onValueChange={setPersona} rows={2} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>{t('novels.reference.knowledge_base')}</Label>
          <Select value={knowledgeBaseId} onValueChange={setKnowledgeBaseId}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue placeholder={t('novels.reference.base_placeholder')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('novels.reference.base_none')}</SelectItem>
              {readyBases.map((base) => (
                <SelectItem key={base.id} value={base.id}>
                  {base.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {knowledgeBaseId !== NONE && (
          <div className="flex flex-col gap-1.5">
            <Label>{t('novels.reference.mode')}</Label>
            <Select value={referenceMode} onValueChange={(value) => setReferenceMode(value as ReferenceMode)}>
              <SelectTrigger size="sm" className="w-full">
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
        )}

        <label className="flex items-center gap-2 text-muted-foreground text-xs">
          <Switch checked={webEnabled} onCheckedChange={setWebEnabled} />
          {t('novels.reference.web_search')}
        </label>

        <div className="flex flex-col gap-1.5">
          <Label>{t('novels.roleplay.context_rounds')}</Label>
          <Select value={String(historyRounds)} onValueChange={(value) => setHistoryRounds(Number(value))}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROUNDS_OPTIONS.map((rounds) => (
                <SelectItem key={rounds} value={String(rounds)}>
                  {rounds === ROUNDS_ALL ? t('novels.write.rounds_all') : t('novels.write.rounds', { count: rounds })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </aside>

      {/* Conversation */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between px-6 py-3">
          <h1 className="font-semibold text-lg">{t('novels.roleplay.title')}</h1>
          <Button variant="ghost" size="sm" onClick={() => setShowPrompt((v) => !v)}>
            {showPrompt ? <EyeOff size={14} /> : <Eye size={14} />}
            {t('novels.roleplay.view_prompt')}
          </Button>
        </div>

        {showPrompt && (
          <div className="mx-6 mb-2 max-h-48 shrink-0 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3">
            <p className="mb-1 text-muted-foreground text-xs">{t('novels.roleplay.prompt_hint')}</p>
            {previewMessages.map((message, index) => (
              <div key={index} className="border-border/50 border-b py-1 last:border-0">
                <span className="text-[10px] text-muted-foreground">
                  {message.role} · {message.source}
                </span>
                <p className="whitespace-pre-wrap text-xs">{message.content}</p>
              </div>
            ))}
            {lastReference && (
              <div className="border-border/50 border-t py-1">
                <span className="text-[10px] text-muted-foreground">
                  system · reference:{lastReference.mode}（{t('novels.roleplay.reference_last_sent')}）
                </span>
                <p className="whitespace-pre-wrap text-xs">{lastReference.block}</p>
              </div>
            )}
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 pb-3">
          {history.map((message, index) => (
            <div
              key={index}
              className={
                message.role === 'user'
                  ? 'self-end rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-primary-foreground'
                  : 'self-start rounded-2xl rounded-bl-sm bg-accent px-4 py-2'
              }>
              <p className="max-w-2xl whitespace-pre-wrap text-sm">{message.content}</p>
            </div>
          ))}
          {isStreaming && (
            <div className="self-start rounded-2xl rounded-bl-sm bg-accent px-4 py-2">
              <p className="max-w-2xl whitespace-pre-wrap text-sm">{streaming || '…'}</p>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-end gap-2 px-6 pb-4">
          <Textarea.Input
            value={draft}
            onValueChange={setDraft}
            rows={2}
            className="flex-1"
            placeholder={t('novels.roleplay.input_placeholder')}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault()
                void handleSend()
              }
            }}
          />
          {isStreaming ? (
            <Button variant="outline" onClick={handleStop}>
              <Square size={14} />
              {t('novels.roleplay.stop')}
            </Button>
          ) : (
            <Button variant="emphasis" disabled={!canSend} onClick={handleSend}>
              <Send size={14} />
              {t('novels.roleplay.send')}
            </Button>
          )}
        </div>
      </div>

      <AssetJsonDialog
        open={jsonDialog !== null}
        onOpenChange={(open) => {
          if (!open) setJsonDialog(null)
        }}
        title={jsonDialog?.title ?? ''}
        json={jsonDialogData}
        onSave={jsonDialog ? handleJsonSave : undefined}
      />
    </div>
  )
}

export default RoleplayPage
