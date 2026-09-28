import { Button, ConfirmDialog, EmptyState } from '@cherrystudio/ui'
import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { Novel } from '@shared/data/types/novel'
import { useNavigate } from '@tanstack/react-router'
import { BookOpen, Drama, Plus, Trash2, Wand2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import CreateNovelDialog from './components/CreateNovelDialog'

const NovelCard = ({
  novel,
  onOpen,
  onDelete
}: {
  novel: Novel
  onOpen: (novel: Novel) => void
  onDelete: (novel: Novel) => void
}) => {
  const updatedAt = new Date(novel.updatedAt).toLocaleDateString()

  return (
    <button
      type="button"
      onClick={() => onOpen(novel)}
      className="group relative flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-accent/30">
      <div className="flex h-24 items-center justify-center rounded-lg bg-accent/40">
        <BookOpen size={28} className="text-muted-foreground" />
      </div>
      <div className="flex flex-col gap-1">
        <span className="truncate font-medium text-sm">{novel.title}</span>
        {novel.synopsis && <span className="line-clamp-2 text-muted-foreground text-xs">{novel.synopsis}</span>}
        <span className="text-muted-foreground text-xs">{updatedAt}</span>
      </div>
      <span
        role="button"
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation()
          onDelete(novel)
        }}
        className="absolute top-2 right-2 hidden rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive group-hover:block">
        <Trash2 size={14} />
      </span>
    </button>
  )
}

const NovelsPage = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = useState(false)
  const [novelToDelete, setNovelToDelete] = useState<Novel | null>(null)

  const { data: novels, isLoading, error } = useQuery('/novels')

  const { trigger: createNovel, isLoading: isCreating } = useMutation('POST', '/novels', {
    refresh: ['/novels']
  })

  const { trigger: deleteNovel } = useMutation('DELETE', '/novels/:novelId', {
    refresh: ['/novels']
  })

  const handleCreate = async (data: { title: string; creationMode: Novel['creationMode'] }) => {
    // Structured mode is a guided wizard, not a bare row — hand the working
    // title over and let the wizard create the novel at its import step.
    if (data.creationMode === 'structured') {
      setCreateOpen(false)
      navigate({ to: '/app/novels/snowflake', search: { title: data.title } })
      return
    }
    await createNovel({ body: data })
    setCreateOpen(false)
  }

  const handleDelete = async () => {
    if (!novelToDelete) return
    try {
      await deleteNovel({ params: { novelId: novelToDelete.id } })
    } catch (deleteError) {
      window.toast.error(formatErrorMessageWithPrefix(deleteError, t('novels.delete.failed')))
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between px-6 py-4">
        <h1 className="font-semibold text-lg">{t('novels.title')}</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate({ to: '/app/novels/remodel' })}>
            <Wand2 size={16} />
            {t('novels.remodel.entry')}
          </Button>
          <Button variant="outline" onClick={() => navigate({ to: '/app/novels/roleplay' })}>
            <Drama size={16} />
            {t('novels.roleplay.entry')}
          </Button>
          <Button variant="emphasis" onClick={() => setCreateOpen(true)}>
            <Plus size={16} />
            {t('novels.create.button')}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {error ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState icon={BookOpen} title={t('novels.load_failed')} compact />
          </div>
        ) : !isLoading && (!novels || novels.length === 0) ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={BookOpen}
              title={t('novels.empty.title')}
              description={t('novels.empty.description')}
              compact
            />
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
            {(novels ?? []).map((novel) => (
              <NovelCard
                key={novel.id}
                novel={novel}
                onOpen={(n) => navigate({ to: '/app/novels/$novelId', params: { novelId: n.id } })}
                onDelete={setNovelToDelete}
              />
            ))}
          </div>
        )}
      </div>

      <CreateNovelDialog
        open={createOpen}
        isSubmitting={isCreating}
        onSubmit={handleCreate}
        onOpenChange={setCreateOpen}
      />

      <ConfirmDialog
        open={novelToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setNovelToDelete(null)
        }}
        title={t('novels.delete.title')}
        description={t('novels.delete.confirm', { title: novelToDelete?.title ?? '' })}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        destructive
        onConfirm={handleDelete}
      />
    </div>
  )
}

export default NovelsPage
