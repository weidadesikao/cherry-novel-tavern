import { Badge, Button, ConfirmDialog, EmptyState } from '@cherrystudio/ui'
import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { NovelEntity, NovelEntityType } from '@shared/data/types/novel'
import { Plus, Trash2, Upload, Users } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import EntityCardDialog from './EntityCardDialog'

const TYPE_ORDER: NovelEntityType[] = ['character', 'location', 'item', 'organization', 'other']

const EntitiesTab = ({ novelId }: { novelId: string }) => {
  const { t } = useTranslation()
  const [toDelete, setToDelete] = useState<NovelEntity | null>(null)
  const [editing, setEditing] = useState<NovelEntity | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: entities, isLoading } = useQuery('/novels/:novelId/entities', { params: { novelId } })

  const { trigger: createEntity, isLoading: isCreating } = useMutation('POST', '/novels/:novelId/entities', {
    refresh: ({ args }) => [`/novels/${args!.params.novelId}/entities`]
  })
  const { trigger: importCard, isLoading: isImporting } = useMutation('POST', '/novels/:novelId/entities/import:st', {
    refresh: ({ args }) => [`/novels/${args!.params.novelId}/entities`]
  })
  const { trigger: deleteEntity } = useMutation('DELETE', '/novels/:novelId/entities/:entityId', {
    refresh: ({ args }) => [`/novels/${args!.params.novelId}/entities`]
  })

  const handleAdd = async () => {
    try {
      const entity = await createEntity({
        params: { novelId },
        body: { type: 'character', name: t('novels.entities.untitled') }
      })
      setEditing(entity)
    } catch (error) {
      window.toast.error(formatErrorMessageWithPrefix(error, t('novels.entities.add_failed')))
    }
  }

  const handleImportFile = async (file: File) => {
    try {
      const json = JSON.parse(await file.text())
      const { warnings } = await importCard({ params: { novelId }, body: { json } })
      if (warnings.length > 0) {
        window.toast.warning(t('novels.entities.import_warnings', { count: warnings.length }))
      }
    } catch (error) {
      window.toast.error(formatErrorMessageWithPrefix(error, t('novels.entities.import_failed')))
    }
  }

  const handleDelete = async () => {
    if (!toDelete) return
    try {
      await deleteEntity({ params: { novelId, entityId: toDelete.id } })
    } catch (error) {
      window.toast.error(formatErrorMessageWithPrefix(error, t('novels.entities.delete.failed')))
    }
  }

  const grouped = TYPE_ORDER.map((type) => ({
    type,
    items: (entities ?? []).filter((entity) => entity.type === type)
  })).filter((group) => group.items.length > 0)

  return (
    <div className="flex h-full flex-col gap-3 pt-3">
      <div className="flex shrink-0 justify-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void handleImportFile(file)
            event.target.value = ''
          }}
        />
        <Button size="sm" variant="outline" loading={isImporting} onClick={() => fileInputRef.current?.click()}>
          <Upload size={14} />
          {t('novels.entities.import_st')}
        </Button>
        <Button size="sm" variant="emphasis" loading={isCreating} onClick={handleAdd}>
          <Plus size={14} />
          {t('novels.entities.add')}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!isLoading && grouped.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState icon={Users} title={t('novels.entities.empty')} compact />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {grouped.map((group) => (
              <section key={group.type} className="flex flex-col gap-2">
                <h3 className="text-muted-foreground text-xs">{t(`novels.entities.type.${group.type}`)}</h3>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
                  {group.items.map((entity) => (
                    <button
                      key={entity.id}
                      type="button"
                      onClick={() => setEditing(entity)}
                      className="group relative flex flex-col gap-1 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-accent/30">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium text-sm">{entity.name}</span>
                        {entity.card.role && (
                          <Badge variant="secondary" className="shrink-0 text-[10px]">
                            {entity.card.role}
                          </Badge>
                        )}
                      </div>
                      {entity.card.description && (
                        <span className="line-clamp-3 text-muted-foreground text-xs">{entity.card.description}</span>
                      )}
                      <span
                        role="button"
                        tabIndex={-1}
                        onClick={(event) => {
                          event.stopPropagation()
                          setToDelete(entity)
                        }}
                        className="absolute top-2 right-2 hidden rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive group-hover:block">
                        <Trash2 size={14} />
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => {
          if (!open) setToDelete(null)
        }}
        title={t('novels.entities.delete.title')}
        description={t('novels.entities.delete.confirm', { name: toDelete?.name ?? '' })}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        destructive
        onConfirm={handleDelete}
      />

      {editing && (
        <EntityCardDialog
          novelId={novelId}
          entity={editing}
          open={editing !== null}
          onOpenChange={(open) => {
            if (!open) setEditing(null)
          }}
        />
      )}
    </div>
  )
}

export default EntitiesTab
