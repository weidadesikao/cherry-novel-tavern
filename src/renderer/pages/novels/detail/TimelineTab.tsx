import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea
} from '@cherrystudio/ui'
import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { TimelineEvent, TimelineEventType } from '@shared/data/types/novel'
import { Clock, MapPin, PenLine, Users } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/** Badge tint per event type — purely visual grouping cue. */
const TYPE_VARIANT: Record<TimelineEventType, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  plot: 'default',
  turn: 'secondary',
  reveal: 'outline',
  conflict: 'destructive',
  daily: 'secondary',
  other: 'outline'
}

const EVENT_TYPES: TimelineEventType[] = ['plot', 'turn', 'reveal', 'conflict', 'daily', 'other']

interface EditState {
  id: string
  title: string
  eventType: TimelineEventType
  storyTime: string
  location: string
  summary: string
  /** Comma/顿号-separated in the input; split on save. */
  participants: string
}

/**
 * Timeline of story events rendered top-to-bottom in `orderKey` order along a
 * vertical spine, with per-event editing.
 */
const TimelineTab = ({ novelId }: { novelId: string }) => {
  const { t } = useTranslation()
  const { data: events, isLoading } = useQuery('/novels/:novelId/events', { params: { novelId } })
  const { trigger: updateEvent, isLoading: isSaving } = useMutation('PATCH', '/novels/:novelId/events/:eventId', {
    refresh: ({ args }) => [`/novels/${args!.params.novelId}/events`]
  })
  const [editing, setEditing] = useState<EditState | null>(null)

  const openEdit = (event: TimelineEvent) => {
    setEditing({
      id: event.id,
      title: event.title,
      eventType: event.eventType,
      storyTime: event.storyTime ?? '',
      location: event.location ?? '',
      summary: event.summary ?? '',
      participants: (event.participants ?? []).join('、')
    })
  }

  const handleSave = async () => {
    if (!editing || !editing.title.trim()) return
    const participants = editing.participants
      .split(/[、,，]/)
      .map((name) => name.trim())
      .filter(Boolean)
    try {
      await updateEvent({
        params: { novelId, eventId: editing.id },
        body: {
          title: editing.title.trim(),
          eventType: editing.eventType,
          storyTime: editing.storyTime.trim() || undefined,
          location: editing.location.trim() || undefined,
          summary: editing.summary.trim() || undefined,
          participants: participants.length > 0 ? participants : undefined
        }
      })
      setEditing(null)
      window.toast.success(t('novels.timeline.saved'))
    } catch (error) {
      window.toast.error(formatErrorMessageWithPrefix(error, t('novels.timeline.save_failed')))
    }
  }

  if (!isLoading && (!events || events.length === 0)) {
    return (
      <div className="flex h-full items-center justify-center pt-3">
        <EmptyState icon={Clock} title={t('novels.timeline.empty')} compact />
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto pt-3 pb-6">
      <ol className="relative ml-3 flex flex-col gap-4 border-border border-l pl-6">
        {(events ?? []).map((event) => (
          <li key={event.id} className="relative">
            {/* node on the spine */}
            <span className="-left-[1.85rem] absolute top-1.5 size-3 rounded-full border-2 border-primary bg-card" />
            <div className="group flex flex-col gap-1 rounded-lg border border-border bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-sm">{event.title}</span>
                <Badge variant={TYPE_VARIANT[event.eventType]} className="text-[10px]">
                  {t(`novels.timeline.type.${event.eventType}`)}
                </Badge>
                {event.storyTime && (
                  <span className="flex items-center gap-0.5 text-muted-foreground text-xs">
                    <Clock size={11} />
                    {event.storyTime}
                  </span>
                )}
                {event.location && (
                  <span className="flex items-center gap-0.5 text-muted-foreground text-xs">
                    <MapPin size={11} />
                    {event.location}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="ml-auto hidden group-hover:inline-flex"
                  title={t('novels.timeline.edit')}
                  onClick={() => openEdit(event)}>
                  <PenLine size={13} />
                </Button>
              </div>
              {event.summary && <p className="text-muted-foreground text-xs">{event.summary}</p>}
              {event.participants && event.participants.length > 0 && (
                <span className="flex items-center gap-0.5 text-muted-foreground text-xs">
                  <Users size={11} />
                  {event.participants.join('、')}
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent size="default">
          <DialogHeader>
            <DialogTitle>{t('novels.timeline.edit')}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="flex flex-col gap-3">
              <div className="flex items-end gap-2">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label>{t('novels.timeline.field_title')}</Label>
                  <Input
                    value={editing.title}
                    onChange={(e) => setEditing((prev) => prev && { ...prev, title: e.target.value })}
                  />
                </div>
                <Select
                  value={editing.eventType}
                  onValueChange={(value) =>
                    setEditing((prev) => prev && { ...prev, eventType: value as TimelineEventType })
                  }>
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EVENT_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {t(`novels.timeline.type.${type}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label>{t('novels.timeline.field_story_time')}</Label>
                  <Input
                    value={editing.storyTime}
                    onChange={(e) => setEditing((prev) => prev && { ...prev, storyTime: e.target.value })}
                  />
                </div>
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label>{t('novels.timeline.field_location')}</Label>
                  <Input
                    value={editing.location}
                    onChange={(e) => setEditing((prev) => prev && { ...prev, location: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t('novels.timeline.field_summary')}</Label>
                <Textarea.Input
                  value={editing.summary}
                  onValueChange={(value: string) => setEditing((prev) => prev && { ...prev, summary: value })}
                  rows={3}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t('novels.timeline.field_participants')}</Label>
                <Input
                  value={editing.participants}
                  onChange={(e) => setEditing((prev) => prev && { ...prev, participants: e.target.value })}
                  placeholder={t('novels.timeline.participants_placeholder')}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  variant="emphasis"
                  size="sm"
                  loading={isSaving}
                  disabled={!editing.title.trim()}
                  onClick={handleSave}>
                  {t('common.save')}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default TimelineTab
