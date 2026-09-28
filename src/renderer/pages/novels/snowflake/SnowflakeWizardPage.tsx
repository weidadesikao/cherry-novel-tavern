import {
  Badge,
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
import { cn } from '@renderer/utils'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { NOVEL_SYNOPSIS_MAX } from '@shared/data/types/novel'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { ChevronLeft, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  buildProposalPrompt,
  buildVolumePlanPrompt,
  composeSynopsis,
  extractJsonObject,
  flattenVolumes,
  normalizeProposals,
  normalizeVolumes,
  type NovelProposal,
  type PlannedVolume
} from './snowflakePlan'

const STEPS = ['idea', 'proposal', 'volumes', 'review'] as const
type Step = (typeof STEPS)[number]

const SnowflakeWizardPage = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { models } = useModels({ enabled: true })
  const search = useSearch({ from: '/app/novels/snowflake' })

  const [step, setStep] = useState<Step>('idea')
  const [modelId, setModelId] = useState('')
  const [inspiration, setInspiration] = useState('')
  const [proposalCount, setProposalCount] = useState(1)
  const [proposals, setProposals] = useState<NovelProposal[]>([])
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [volumes, setVolumes] = useState<PlannedVolume[]>([])
  const [title, setTitle] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isWriting, setIsWriting] = useState(false)

  const createNovel = useMutation('POST', '/novels', { refresh: ['/novels'] }).trigger
  const createEntity = useMutation('POST', '/novels/:novelId/entities').trigger
  const createChapter = useMutation('POST', '/novels/:novelId/chapters').trigger

  const chosen = selectedIndex !== null ? proposals[selectedIndex] : undefined

  const handleProposals = async () => {
    if (!modelId || !inspiration.trim()) return
    setIsGenerating(true)
    try {
      const { text } = await window.api.ai.generateText({
        uniqueModelId: modelId,
        prompt: buildProposalPrompt(inspiration.trim(), proposalCount)
      })
      const list = normalizeProposals(extractJsonObject(text))
      if (list.length === 0) throw new Error(t('novels.snowflake.generate_empty'))
      setProposals(list)
      setSelectedIndex(list.length === 1 ? 0 : null)
      setStep('proposal')
    } catch (error) {
      window.toast.error(formatErrorMessageWithPrefix(error, t('novels.snowflake.generate_failed')))
    } finally {
      setIsGenerating(false)
    }
  }

  const handleVolumes = async () => {
    if (!chosen) return
    setIsGenerating(true)
    try {
      const { text } = await window.api.ai.generateText({
        uniqueModelId: modelId,
        prompt: buildVolumePlanPrompt(chosen)
      })
      const list = normalizeVolumes(extractJsonObject(text))
      if (list.length === 0) throw new Error(t('novels.snowflake.generate_empty'))
      setVolumes(list)
      setTitle((prev) => prev || search.title || chosen.title)
      setStep('volumes')
    } catch (error) {
      window.toast.error(formatErrorMessageWithPrefix(error, t('novels.snowflake.generate_failed')))
    } finally {
      setIsGenerating(false)
    }
  }

  const handleConfirm = async () => {
    if (!chosen || volumes.length === 0) return
    setIsWriting(true)
    try {
      const novel = await createNovel({
        body: {
          title: title.trim() || chosen.title,
          creationMode: 'structured',
          synopsis: composeSynopsis(chosen, volumes).slice(0, NOVEL_SYNOPSIS_MAX) || undefined
        }
      })

      for (const character of chosen.characters) {
        await createEntity({
          params: { novelId: novel.id },
          body: {
            type: 'character',
            name: character.name,
            card: {
              description: character.description || undefined,
              role: character.role || undefined
            }
          }
        })
      }

      for (const chapter of flattenVolumes(volumes)) {
        await createChapter({
          params: { novelId: novel.id },
          body: { title: chapter.title, outline: chapter.outline || undefined }
        })
      }

      window.toast.success(t('novels.snowflake.create_success'))
      navigate({ to: '/app/novels/$novelId', params: { novelId: novel.id } })
    } catch (error) {
      window.toast.error(formatErrorMessageWithPrefix(error, t('novels.snowflake.create_failed')))
    } finally {
      setIsWriting(false)
    }
  }

  const chapterTotal = volumes.reduce((sum, volume) => sum + volume.chapters.length, 0)

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 px-6 py-4">
        <button
          type="button"
          onClick={() => navigate({ to: '/app/novels' })}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground text-sm transition-colors hover:bg-accent/50 hover:text-foreground">
          <ChevronLeft size={16} />
          {t('novels.snowflake.back')}
        </button>
        <h1 className="font-semibold text-lg">{t('novels.snowflake.title')}</h1>
      </div>

      <div className="mx-auto flex w-full max-w-2xl shrink-0 items-center gap-2 px-6 pb-4">
        {STEPS.map((s, i) => {
          const reached = STEPS.indexOf(step) >= i
          return (
            <div key={s} className="flex flex-1 items-center gap-2">
              <div className={cn('h-2 w-2 shrink-0 rounded-full', reached ? 'bg-primary' : 'bg-border')} />
              <span className={cn('text-xs', reached ? 'text-foreground' : 'text-muted-foreground')}>
                {t(`novels.snowflake.step_${s}`)}
              </span>
              {i < STEPS.length - 1 && <div className="h-px flex-1 bg-border" />}
            </div>
          )
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        {step === 'idea' && (
          <div className="mx-auto flex max-w-xl flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label>{t('novels.snowflake.idea_label')}</Label>
              <span className="text-muted-foreground text-xs">{t('novels.snowflake.idea_hint')}</span>
              <Textarea.Input
                value={inspiration}
                onValueChange={setInspiration}
                rows={5}
                placeholder={t('novels.snowflake.idea_placeholder')}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>{t('novels.snowflake.model')}</Label>
              <Select value={modelId} onValueChange={setModelId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('novels.snowflake.model_placeholder')} />
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

            <div className="flex items-end gap-3">
              <div className="flex flex-col gap-2">
                <Label>{t('novels.snowflake.proposal_count')}</Label>
                <Input
                  type="number"
                  min={1}
                  max={3}
                  className="w-24"
                  value={proposalCount}
                  onChange={(event) => {
                    const parsed = Number.parseInt(event.target.value, 10)
                    setProposalCount(Number.isNaN(parsed) ? 1 : Math.min(3, Math.max(1, parsed)))
                  }}
                />
              </div>
              <Button
                variant="emphasis"
                className="flex-1"
                disabled={!modelId || !inspiration.trim()}
                loading={isGenerating}
                onClick={handleProposals}>
                <Sparkles size={16} />
                {t('novels.snowflake.generate')}
              </Button>
            </div>
          </div>
        )}

        {step === 'proposal' && (
          <div className="mx-auto flex max-w-2xl flex-col gap-4">
            <span className="text-muted-foreground text-sm">{t('novels.snowflake.proposal_pick')}</span>
            {proposals.map((proposal, index) => (
              <button
                key={`${proposal.title}-${index}`}
                type="button"
                onClick={() => setSelectedIndex(index)}
                className={cn(
                  'flex flex-col gap-2 rounded-lg border p-4 text-left transition-colors',
                  selectedIndex === index ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/50'
                )}>
                <span className="font-medium">{proposal.title}</span>
                <span className="text-sm">{proposal.logline}</span>
                <span className="whitespace-pre-wrap text-muted-foreground text-xs">{proposal.synopsis}</span>
                {proposal.characters.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {proposal.characters.map((character) => (
                      <Badge key={character.name} variant="secondary" className="text-[10px]">
                        {character.name}
                        {character.role ? `·${character.role}` : ''}
                      </Badge>
                    ))}
                  </div>
                )}
              </button>
            ))}
            <div className="flex justify-between gap-2">
              <Button variant="outline" onClick={() => setStep('idea')}>
                {t('novels.snowflake.prev')}
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" loading={isGenerating} onClick={handleProposals}>
                  {t('novels.snowflake.regenerate')}
                </Button>
                <Button
                  variant="emphasis"
                  disabled={selectedIndex === null}
                  loading={isGenerating}
                  onClick={handleVolumes}>
                  {t('novels.snowflake.next_volumes')}
                </Button>
              </div>
            </div>
          </div>
        )}

        {step === 'volumes' && (
          <div className="mx-auto flex max-w-2xl flex-col gap-4">
            {volumes.map((volume, index) => (
              <div key={`${volume.title}-${index}`} className="flex flex-col gap-2 rounded-lg border p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{volume.title}</span>
                  <span className="text-muted-foreground text-xs">
                    {t('novels.snowflake.chapter_count', { count: volume.chapters.length })}
                  </span>
                </div>
                <span className="text-muted-foreground text-sm">{volume.summary}</span>
                <div className="flex flex-col gap-1.5 pt-1">
                  {volume.chapters.map((chapter, chapterIndex) => (
                    <div key={`${chapter.title}-${chapterIndex}`} className="rounded-md bg-accent/40 px-3 py-2">
                      <div className="font-medium text-sm">{chapter.title}</div>
                      <div className="text-muted-foreground text-xs">{chapter.outline}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div className="flex justify-between gap-2">
              <Button variant="outline" onClick={() => setStep('proposal')}>
                {t('novels.snowflake.prev')}
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" loading={isGenerating} onClick={handleVolumes}>
                  {t('novels.snowflake.regenerate')}
                </Button>
                <Button variant="emphasis" onClick={() => setStep('review')}>
                  {t('novels.snowflake.next_review')}
                </Button>
              </div>
            </div>
          </div>
        )}

        {step === 'review' && chosen && (
          <div className="mx-auto flex max-w-xl flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label>{t('novels.snowflake.review_title')}</Label>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} />
            </div>
            <span className="text-muted-foreground text-sm">
              {t('novels.snowflake.review_stats', {
                volumes: volumes.length,
                chapters: chapterTotal,
                characters: chosen.characters.length
              })}
            </span>
            <div className="flex flex-col gap-2">
              <Label>{t('novels.snowflake.review_synopsis')}</Label>
              <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-md border p-3 text-muted-foreground text-xs">
                {composeSynopsis(chosen, volumes)}
              </div>
            </div>
            <div className="flex justify-between gap-2">
              <Button variant="outline" onClick={() => setStep('volumes')}>
                {t('novels.snowflake.prev')}
              </Button>
              <Button variant="emphasis" loading={isWriting} onClick={handleConfirm}>
                {t('novels.snowflake.confirm')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default SnowflakeWizardPage
