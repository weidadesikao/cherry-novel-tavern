import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { NovelEntity, NovelEntityCard, NovelEntityType } from '@shared/data/types/novel'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const TYPE_OPTIONS: NovelEntityType[] = ['character', 'location', 'item', 'organization', 'other']

/** The editable rich card fields, in display order. `aliases` is comma-joined for the textbox. */
const TEXT_FIELDS: Array<{ key: keyof NovelEntityCard; rows: number }> = [
  { key: 'description', rows: 3 },
  { key: 'personality', rows: 2 },
  { key: 'appearance', rows: 2 },
  { key: 'background', rows: 3 },
  { key: 'statusChanges', rows: 2 },
  { key: 'scenario', rows: 2 }
]

export interface EntityCardDialogProps {
  novelId: string
  entity: NovelEntity
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Character-card detail + editor (PRD §3.2). Shows the rich profile in titled
 * sections and lets the user edit every field, saving via PATCH. Mirrors the
 * mockup's 人物档案 / 角色简介 / 性格 / 外貌 / 背景 / 状态变化 layout.
 */
const EntityCardDialog = ({ novelId, entity, open, onOpenChange }: EntityCardDialogProps) => {
  const { t } = useTranslation()

  const [name, setName] = useState(entity.name)
  const [type, setType] = useState<NovelEntityType>(entity.type)
  const [card, setCard] = useState<NovelEntityCard>(entity.card)
  const [aliasText, setAliasText] = useState((entity.card.aliases ?? []).join('、'))

  // Reset local state whenever a different entity is opened.
  useEffect(() => {
    setName(entity.name)
    setType(entity.type)
    setCard(entity.card)
    setAliasText((entity.card.aliases ?? []).join('、'))
  }, [entity])

  const { trigger: updateEntity, isLoading: isSaving } = useMutation('PATCH', '/novels/:novelId/entities/:entityId', {
    refresh: ({ args }) => [`/novels/${args!.params.novelId}/entities`]
  })

  const setField = (key: keyof NovelEntityCard, value: string) => {
    setCard((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = async () => {
    const aliases = aliasText
      .split(/[、,，]/)
      .map((a) => a.trim())
      .filter(Boolean)
    const nextCard: NovelEntityCard = { ...card, aliases: aliases.length > 0 ? aliases : undefined }
    try {
      await updateEntity({
        params: { novelId, entityId: entity.id },
        body: { name: name.trim() || entity.name, type, card: nextCard }
      })
      window.toast.success(t('novels.entities.card.saved'))
      onOpenChange(false)
    } catch (error) {
      window.toast.error(formatErrorMessageWithPrefix(error, t('novels.entities.card.save_failed')))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('novels.entities.card.title')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* 人物档案: name / type / role / status / affiliation / aliases */}
          <section className="grid grid-cols-2 gap-3 rounded-lg border border-border p-3">
            <div className="flex flex-col gap-1.5">
              <Label>{t('novels.entities.card.name')}</Label>
              <Input value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t('novels.entities.card.type')}</Label>
              <Select value={type} onValueChange={(value) => setType(value as NovelEntityType)}>
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {t(`novels.entities.type.${option}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t('novels.entities.card.role')}</Label>
              <Input value={card.role ?? ''} onChange={(event) => setField('role', event.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t('novels.entities.card.status')}</Label>
              <Input value={card.status ?? ''} onChange={(event) => setField('status', event.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t('novels.entities.card.affiliation')}</Label>
              <Input value={card.affiliation ?? ''} onChange={(event) => setField('affiliation', event.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t('novels.entities.card.aliases')}</Label>
              <Input value={aliasText} onChange={(event) => setAliasText(event.target.value)} />
            </div>
          </section>

          {TEXT_FIELDS.map(({ key, rows }) => (
            <div key={key} className="flex flex-col gap-1.5">
              <Label>{t(`novels.entities.card.${key}`)}</Label>
              <Textarea.Input
                value={(card[key] as string | undefined) ?? ''}
                onValueChange={(value) => setField(key, value)}
                rows={rows}
              />
            </div>
          ))}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="emphasis" loading={isSaving} onClick={handleSave}>
              {t('novels.entities.card.save')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default EntityCardDialog
