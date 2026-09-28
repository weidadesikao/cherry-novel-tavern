import { Button, ConfirmDialog, EmptyState } from '@cherrystudio/ui'
import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { ChapterMeta } from '@shared/data/types/novel'
import { useNavigate } from '@tanstack/react-router'
import { FileText, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

const ChaptersTab = ({ novelId }: { novelId: string }) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [toDelete, setToDelete] = useState<ChapterMeta | null>(null)

  const { data: chapters, isLoading } = useQuery('/novels/:novelId/chapters', { params: { novelId } })

  const { trigger: createChapter, isLoading: isCreating } = useMutation('POST', '/novels/:novelId/chapters', {
    refresh: ({ args }) => [`/novels/${args!.params.novelId}/chapters`]
  })
  const { trigger: deleteChapter } = useMutation('DELETE', '/novels/:novelId/chapters/:chapterId', {
    refresh: ({ args }) => [`/novels/${args!.params.novelId}/chapters`]
  })

  const handleAdd = async () => {
    try {
      await createChapter({ params: { novelId }, body: { title: t('novels.chapters.untitled') } })
    } catch (error) {
      window.toast.error(formatErrorMessageWithPrefix(error, t('novels.chapters.add_failed')))
    }
  }

  const handleDelete = async () => {
    if (!toDelete) return
    try {
      await deleteChapter({ params: { novelId, chapterId: toDelete.id } })
    } catch (error) {
      window.toast.error(formatErrorMessageWithPrefix(error, t('novels.chapters.delete.failed')))
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 pt-3">
      <div className="flex shrink-0 justify-end">
        <Button size="sm" variant="emphasis" loading={isCreating} onClick={handleAdd}>
          <Plus size={14} />
          {t('novels.chapters.add')}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!isLoading && (!chapters || chapters.length === 0) ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState icon={FileText} title={t('novels.chapters.empty')} compact />
          </div>
        ) : (
          <ol className="flex flex-col gap-1">
            {(chapters ?? []).map((chapter, index) => (
              <li
                key={chapter.id}
                className="group flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
                <span className="w-6 shrink-0 text-center text-muted-foreground text-xs">{index + 1}</span>
                <button
                  type="button"
                  onClick={() =>
                    navigate({
                      to: '/app/novels/write/$novelId/$chapterId',
                      params: { novelId, chapterId: chapter.id }
                    })
                  }
                  className="flex min-w-0 flex-1 flex-col text-left">
                  <span className="truncate font-medium text-sm">{chapter.title}</span>
                  <span className="text-muted-foreground text-xs">
                    {t('novels.chapters.word_count', { count: chapter.wordCount })}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setToDelete(chapter)}
                  className="hidden rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive group-hover:block">
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => {
          if (!open) setToDelete(null)
        }}
        title={t('novels.chapters.delete.title')}
        description={t('novels.chapters.delete.confirm', { title: toDelete?.title ?? '' })}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        destructive
        onConfirm={handleDelete}
      />
    </div>
  )
}

export default ChaptersTab
