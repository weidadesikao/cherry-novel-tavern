import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  FieldError,
  Input,
  Label
} from '@cherrystudio/ui'
import { cn } from '@renderer/utils'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { NovelCreationMode } from '@shared/data/types/novel'
import { GitBranch, Mail, Zap } from 'lucide-react'
import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface CreateNovelDialogProps {
  open: boolean
  isSubmitting: boolean
  onSubmit: (data: { title: string; creationMode: NovelCreationMode }) => Promise<void>
  onOpenChange: (open: boolean) => void
}

interface ModeOption {
  mode: NovelCreationMode
  icon: typeof Zap
  labelKey: string
  descriptionKey: string
  /** Wizards not yet built stay disabled here. */
  comingSoon: boolean
}

const MODE_OPTIONS: ModeOption[] = [
  {
    mode: 'free',
    icon: Zap,
    labelKey: 'novels.create.mode.free',
    descriptionKey: 'novels.create.mode.free_description',
    comingSoon: false
  },
  {
    mode: 'structured',
    icon: GitBranch,
    labelKey: 'novels.create.mode.structured',
    descriptionKey: 'novels.create.mode.structured_description',
    comingSoon: false
  },
  {
    mode: 'remodel',
    icon: Mail,
    labelKey: 'novels.create.mode.remodel',
    descriptionKey: 'novels.create.mode.remodel_description',
    comingSoon: true
  }
]

const CreateNovelDialog = ({ open, isSubmitting, onSubmit, onOpenChange }: CreateNovelDialogProps) => {
  const { t } = useTranslation()
  const [title, setTitle] = useState('')
  const [mode, setMode] = useState<NovelCreationMode>('free')
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setTitle('')
      setMode('free')
      setHasAttemptedSubmit(false)
      setSubmitError(null)
    }
  }, [open])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const normalizedTitle = title.trim()

    setHasAttemptedSubmit(true)
    setSubmitError(null)

    if (!normalizedTitle) {
      return
    }

    try {
      await onSubmit({ title: normalizedTitle, creationMode: mode })
    } catch (error) {
      setSubmitError(formatErrorMessageWithPrefix(error, t('novels.create.failed')))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="default">
        <DialogHeader>
          <DialogTitle>{t('novels.create.dialog_title')}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="novel-title">{t('novels.create.name_label')}</Label>
            <Input
              id="novel-title"
              autoFocus
              value={title}
              aria-invalid={hasAttemptedSubmit && !title.trim()}
              placeholder={t('novels.create.name_placeholder')}
              onChange={(event) => {
                setTitle(event.target.value)
                setSubmitError(null)
              }}
            />
            {hasAttemptedSubmit && !title.trim() ? <FieldError>{t('novels.create.name_required')}</FieldError> : null}
            {submitError ? <FieldError>{submitError}</FieldError> : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t('novels.create.mode_label')}</Label>
            <div className="grid grid-cols-1 gap-2">
              {MODE_OPTIONS.map((option) => {
                const Icon = option.icon
                const isSelected = mode === option.mode
                return (
                  <button
                    key={option.mode}
                    type="button"
                    disabled={option.comingSoon}
                    onClick={() => setMode(option.mode)}
                    className={cn(
                      'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                      isSelected ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/50',
                      option.comingSoon && 'cursor-not-allowed opacity-50 hover:bg-transparent'
                    )}>
                    <Icon size={18} className="mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="flex flex-col gap-0.5">
                      <span className="flex items-center gap-2 font-medium text-sm">
                        {t(option.labelKey)}
                        {option.comingSoon && (
                          <Badge variant="secondary" className="text-[10px]">
                            {t('novels.create.mode.coming_soon')}
                          </Badge>
                        )}
                      </span>
                      <span className="text-muted-foreground text-xs">{t(option.descriptionKey)}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="emphasis" loading={isSubmitting}>
              {t('novels.create.submit')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default CreateNovelDialog
