import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea
} from '@cherrystudio/ui'
import { useMutation } from '@data/hooks/useDataApi'
import { useModels } from '@renderer/hooks/useModel'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { useNavigate } from '@tanstack/react-router'
import { ChevronDown, ChevronLeft, ChevronRight, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type AnalysisProgress,
  type AnalysisResult,
  analyzeNovel,
  DEFAULT_CHAPTER_DIGEST_INSTRUCTIONS,
  DEFAULT_PROFILE_INSTRUCTIONS,
  DEFAULT_SCAN_INSTRUCTIONS,
  DEFAULT_WHOLE_BOOK_INSTRUCTIONS,
  resolveRelations,
  WHOLE_BOOK_MAX_CHARS
} from './novelAnalysis'

type Step = 'setup' | 'analyzing' | 'review'
type AnalyzeMode = 'chunked' | 'whole'

/** Valid DB event-type enum; the model's free-text type is mapped onto this. */
const EVENT_TYPES = ['plot', 'turn', 'reveal', 'conflict', 'daily', 'other'] as const

const DEFAULT_PROMPTS = {
  scan: DEFAULT_SCAN_INSTRUCTIONS,
  wholeBook: DEFAULT_WHOLE_BOOK_INSTRUCTIONS,
  profile: DEFAULT_PROFILE_INSTRUCTIONS,
  chapterDigest: DEFAULT_CHAPTER_DIGEST_INSTRUCTIONS
}

const RemodelWizardPage = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { models } = useModels({ enabled: true })
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('setup')
  const [title, setTitle] = useState('')
  const [modelId, setModelId] = useState('')
  const [fileName, setFileName] = useState('')
  const [text, setText] = useState('')
  const [mode, setMode] = useState<AnalyzeMode>('chunked')
  const [prompts, setPrompts] = useState(DEFAULT_PROMPTS)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [progress, setProgress] = useState<AnalysisProgress>({ phase: 'scan', current: 0, total: 0 })
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [isWriting, setIsWriting] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const createNovel = useMutation('POST', '/novels', { refresh: ['/novels'] }).trigger
  const createEntity = useMutation('POST', '/novels/:novelId/entities').trigger
  const createChapter = useMutation('POST', '/novels/:novelId/chapters').trigger
  const createRelation = useMutation('POST', '/novels/:novelId/relations').trigger
  const createEvent = useMutation('POST', '/novels/:novelId/events').trigger
  const createWorldbook = useMutation('POST', '/worldbooks', { refresh: ['/worldbooks'] }).trigger
  const createWorldbookEntry = useMutation('POST', '/worldbooks/:worldbookId/entries').trigger

  const handleFile = async (file: File) => {
    setFileName(file.name)
    setText(await file.text())
    if (!title.trim()) setTitle(file.name.replace(/\.(txt|md)$/i, ''))
  }

  const handleAnalyze = async () => {
    if (!modelId || !text.trim()) return
    if (mode === 'whole' && text.length > WHOLE_BOOK_MAX_CHARS) {
      window.toast.error(t('novels.remodel.fast_too_long', { count: text.length, max: WHOLE_BOOK_MAX_CHARS }))
      return
    }
    setStep('analyzing')
    setProgress({ phase: mode === 'whole' ? 'whole' : 'scan', current: 0, total: 0 })
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const analysis = await analyzeNovel(text, {
        uniqueModelId: modelId,
        mode,
        prompts,
        onProgress: setProgress,
        signal: controller.signal
      })
      setResult(analysis)
      setStep('review')
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') {
        window.toast.error(formatErrorMessageWithPrefix(error, t('novels.remodel.analyze_failed')))
      }
      setStep('setup')
    } finally {
      abortRef.current = null
    }
  }

  const handleConfirm = async () => {
    if (!result) return
    setIsWriting(true)
    try {
      // Style profile rides along in the synopsis beneath the outline.
      const synopsis = [result.outline, result.styleProfile && `【风格档案】\n${result.styleProfile}`]
        .filter(Boolean)
        .join('\n\n')

      const novel = await createNovel({
        body: {
          title: title.trim() || t('novels.remodel.untitled'),
          creationMode: 'imported',
          synopsis: synopsis || undefined
        }
      })

      // Track entity name → id so relations can be resolved after creation.
      const nameToId = new Map<string, string>()

      for (const character of result.characters) {
        const entity = await createEntity({
          params: { novelId: novel.id },
          body: {
            type: 'character',
            name: character.name,
            card: {
              description: character.description || undefined,
              personality: character.personality || undefined,
              appearance: character.appearance || undefined,
              background: character.background || undefined,
              statusChanges: character.statusChanges || undefined,
              role: character.role || undefined,
              status: character.status || undefined,
              affiliation: character.affiliation || undefined,
              aliases: character.aliases.length > 0 ? character.aliases : undefined
            }
          }
        })
        nameToId.set(character.name, entity.id)
        // Index aliases too, so relations referring to short forms resolve.
        for (const alias of character.aliases) nameToId.set(alias, entity.id)
      }

      for (const organization of result.organizations) {
        const entity = await createEntity({
          params: { novelId: novel.id },
          body: { type: 'organization', name: organization.name, card: { description: organization.description } }
        })
        nameToId.set(organization.name, entity.id)
      }

      for (const relation of resolveRelations(result.relations, nameToId)) {
        await createRelation({ params: { novelId: novel.id }, body: relation })
      }

      for (const event of result.events) {
        const eventType = EVENT_TYPES.includes(event.eventType as (typeof EVENT_TYPES)[number])
          ? (event.eventType as (typeof EVENT_TYPES)[number])
          : 'other'
        await createEvent({
          params: { novelId: novel.id },
          body: {
            title: event.title,
            summary: event.summary || undefined,
            eventType,
            storyTime: event.storyTime || undefined,
            location: event.location || undefined,
            participants: event.participants.length > 0 ? event.participants : undefined
          }
        })
      }

      for (const chapter of result.chapters) {
        await createChapter({
          params: { novelId: novel.id },
          body: { title: chapter.title, content: chapter.content, outline: chapter.summary || undefined }
        })
      }

      if (result.worldbook.length > 0) {
        const worldbook = await createWorldbook({
          body: { name: t('novels.remodel.worldbook_name', { title: title.trim() }) }
        })
        for (const entry of result.worldbook) {
          await createWorldbookEntry({
            params: { worldbookId: worldbook.id },
            body: { keys: [entry.keyword], content: entry.content, comment: entry.keyword }
          })
        }
      }

      window.toast.success(t('novels.remodel.write_success'))
      navigate({ to: '/app/novels/$novelId', params: { novelId: novel.id } })
    } catch (error) {
      window.toast.error(formatErrorMessageWithPrefix(error, t('novels.remodel.write_failed')))
    } finally {
      setIsWriting(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 px-6 py-4">
        <button
          type="button"
          onClick={() => navigate({ to: '/app/novels' })}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground text-sm transition-colors hover:bg-accent/50 hover:text-foreground">
          <ChevronLeft size={16} />
          {t('novels.remodel.back')}
        </button>
        <h1 className="font-semibold text-lg">{t('novels.remodel.title')}</h1>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        {step === 'setup' && (
          <div className="mx-auto flex max-w-xl flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label>{t('novels.remodel.file')}</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,text/plain"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void handleFile(file)
                  event.target.value = ''
                }}
              />
              <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                <Upload size={16} />
                {fileName || t('novels.remodel.file_pick')}
              </Button>
              {text && (
                <span className="text-muted-foreground text-xs">
                  {t('novels.remodel.char_count', { count: text.length })}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label>{t('novels.remodel.novel_title')}</Label>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} />
            </div>

            <div className="flex flex-col gap-2">
              <Label>{t('novels.remodel.model')}</Label>
              <Select value={modelId} onValueChange={setModelId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('novels.remodel.model_placeholder')} />
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

            <div className="flex flex-col gap-2">
              <Label>{t('novels.remodel.mode')}</Label>
              <Select value={mode} onValueChange={(value) => setMode(value as AnalyzeMode)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="chunked">{t('novels.remodel.mode_chunked')}</SelectItem>
                  <SelectItem value="whole">{t('novels.remodel.mode_fast')}</SelectItem>
                </SelectContent>
              </Select>
              {mode === 'whole' && text.length > WHOLE_BOOK_MAX_CHARS && (
                <span className="text-destructive text-xs">
                  {t('novels.remodel.fast_too_long', { count: text.length, max: WHOLE_BOOK_MAX_CHARS })}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setShowAdvanced((prev) => !prev)}
                className="flex items-center gap-1 self-start text-muted-foreground text-sm transition-colors hover:text-foreground">
                {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                {t('novels.remodel.advanced')}
              </button>
              {showAdvanced && (
                <div className="flex flex-col gap-4 rounded-md border p-3">
                  <span className="text-muted-foreground text-xs">{t('novels.remodel.prompt_hint')}</span>
                  {mode === 'whole' ? (
                    <div className="flex flex-col gap-1.5">
                      <Label>{t('novels.remodel.prompt_whole')}</Label>
                      <Textarea.Input
                        value={prompts.wholeBook}
                        onValueChange={(value: string) => setPrompts((prev) => ({ ...prev, wholeBook: value }))}
                        rows={10}
                      />
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-col gap-1.5">
                        <Label>{t('novels.remodel.prompt_scan')}</Label>
                        <Textarea.Input
                          value={prompts.scan}
                          onValueChange={(value: string) => setPrompts((prev) => ({ ...prev, scan: value }))}
                          rows={8}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label>{t('novels.remodel.prompt_profile')}</Label>
                        <Textarea.Input
                          value={prompts.profile}
                          onValueChange={(value: string) => setPrompts((prev) => ({ ...prev, profile: value }))}
                          rows={8}
                        />
                      </div>
                    </>
                  )}
                  <div className="flex flex-col gap-1.5">
                    <Label>{t('novels.remodel.prompt_chapter')}</Label>
                    <Textarea.Input
                      value={prompts.chapterDigest}
                      onValueChange={(value: string) => setPrompts((prev) => ({ ...prev, chapterDigest: value }))}
                      rows={2}
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onClick={() => setPrompts(DEFAULT_PROMPTS)}>
                    {t('novels.remodel.prompt_reset')}
                  </Button>
                </div>
              )}
            </div>

            <Button variant="emphasis" disabled={!modelId || !text.trim()} onClick={handleAnalyze}>
              {t('novels.remodel.start')}
            </Button>
          </div>
        )}

        {step === 'analyzing' && (
          <div className="mx-auto flex max-w-xl flex-col items-center gap-4 pt-20">
            <p className="text-sm">
              {t(`novels.remodel.phase_${progress.phase}`, {
                current: progress.current,
                total: progress.total || '…'
              })}
            </p>
            <div className="h-2 w-full overflow-hidden rounded-full bg-accent">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: progress.total ? `${(progress.current / progress.total) * 100}%` : '5%' }}
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => abortRef.current?.abort()}>
              {t('common.cancel')}
            </Button>
          </div>
        )}

        {step === 'review' && result && (
          <div className="mx-auto flex max-w-3xl flex-col gap-6">
            <section className="flex flex-col gap-2">
              <h2 className="font-medium text-sm">
                {t('novels.remodel.section_characters', { count: result.characters.length })}
              </h2>
              {result.characters.map((character, index) => (
                <div key={index} className="flex flex-col gap-1 rounded-lg border border-border p-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{character.name}</span>
                    {character.role && (
                      <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {character.role}
                      </span>
                    )}
                    {character.aliases.length > 0 && (
                      <span className="text-muted-foreground text-xs">（{character.aliases.join('、')}）</span>
                    )}
                  </div>
                  {character.description && <p className="text-muted-foreground text-xs">{character.description}</p>}
                  {character.personality && (
                    <p className="text-muted-foreground text-xs">
                      <span className="text-foreground">{t('novels.entities.card.personality')}：</span>
                      {character.personality}
                    </p>
                  )}
                  {character.background && (
                    <p className="line-clamp-2 text-muted-foreground text-xs">
                      <span className="text-foreground">{t('novels.entities.card.background')}：</span>
                      {character.background}
                    </p>
                  )}
                </div>
              ))}
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="font-medium text-sm">
                {t('novels.remodel.section_chapters', { count: result.chapters.length })}
              </h2>
              <ol className="flex flex-col gap-1">
                {result.chapters.map((chapter, index) => (
                  <li key={index} className="rounded-lg border border-border px-3 py-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium text-sm">
                        {index + 1}. {chapter.title}
                      </span>
                      <span className="shrink-0 text-muted-foreground text-xs">
                        {t('novels.chapters.word_count', { count: chapter.content.replace(/\s/g, '').length })}
                      </span>
                    </div>
                    {chapter.summary && <p className="text-muted-foreground text-xs">{chapter.summary}</p>}
                  </li>
                ))}
              </ol>
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="font-medium text-sm">
                {t('novels.remodel.section_worldbook', { count: result.worldbook.length })}
              </h2>
              {result.worldbook.map((entry, index) => (
                <div key={index} className="rounded-lg border border-border px-3 py-2">
                  <span className="font-medium text-sm">{entry.keyword}</span>
                  <p className="text-muted-foreground text-xs">{entry.content}</p>
                </div>
              ))}
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="font-medium text-sm">
                {t('novels.remodel.section_organizations', { count: result.organizations.length })}
              </h2>
              {result.organizations.map((org, index) => (
                <div key={index} className="rounded-lg border border-border px-3 py-2">
                  <span className="font-medium text-sm">{org.name}</span>
                  <p className="text-muted-foreground text-xs">{org.description}</p>
                </div>
              ))}
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="font-medium text-sm">
                {t('novels.remodel.section_relations', { count: result.relations.length })}
              </h2>
              {result.relations.map((relation, index) => (
                <div key={index} className="rounded-lg border border-border px-3 py-2 text-sm">
                  <span className="font-medium">
                    {relation.fromName} → {relation.toName}
                  </span>
                  <span className="ml-2 text-muted-foreground text-xs">{relation.relationType}</span>
                  {relation.description && <p className="text-muted-foreground text-xs">{relation.description}</p>}
                </div>
              ))}
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="font-medium text-sm">
                {t('novels.remodel.section_events', { count: result.events.length })}
              </h2>
              <ol className="flex flex-col gap-1">
                {result.events.map((event, index) => (
                  <li key={index} className="rounded-lg border border-border px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{event.title}</span>
                      {event.storyTime && <span className="text-muted-foreground text-xs">{event.storyTime}</span>}
                    </div>
                    {event.summary && <p className="text-muted-foreground text-xs">{event.summary}</p>}
                  </li>
                ))}
              </ol>
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="font-medium text-sm">{t('novels.remodel.section_outline')}</h2>
              <p className="whitespace-pre-wrap rounded-lg border border-border p-3 text-muted-foreground text-sm">
                {result.outline}
              </p>
            </section>

            {result.styleProfile && (
              <section className="flex flex-col gap-2">
                <h2 className="font-medium text-sm">{t('novels.remodel.section_style')}</h2>
                <p className="whitespace-pre-wrap rounded-lg border border-border p-3 text-muted-foreground text-sm">
                  {result.styleProfile}
                </p>
              </section>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStep('setup')}>
                {t('novels.remodel.reanalyze')}
              </Button>
              <Button variant="emphasis" loading={isWriting} onClick={handleConfirm}>
                {t('novels.remodel.confirm')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default RemodelWizardPage
