/**
 * M10 novel detail — copy of NovelDetailPage inside the /app/novels-m10
 * section. Entities / relations / timeline tabs are the ORIGINAL components
 * (no navigation inside them); only the chapters tab is a local copy whose
 * write button enters the M10 grafted workbench.
 */

import { EmptyState, Tabs, TabsContent, TabsList, TabsTrigger } from '@cherrystudio/ui'
import { useQuery } from '@data/hooks/useDataApi'
import { useNavigate, useParams } from '@tanstack/react-router'
import { BookOpen, ChevronLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import EntitiesTab from '../novels/detail/EntitiesTab'
import RelationsTab from '../novels/detail/RelationsTab'
import TimelineTab from '../novels/detail/TimelineTab'
import ChaptersM10Tab from './ChaptersM10Tab'

const NovelM10DetailPage = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { novelId } = useParams({ strict: false }) as { novelId: string }

  const { data: novel, isLoading, error } = useQuery('/novels/:novelId', { params: { novelId } })

  if (!isLoading && (error || !novel)) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={BookOpen}
          title={error ? t('novels.detail.load_failed') : t('novels.detail.not_found')}
          compact
        />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 px-6 py-4">
        <button
          type="button"
          onClick={() => navigate({ to: '/app/novels-m10' })}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground text-sm transition-colors hover:bg-accent/50 hover:text-foreground">
          <ChevronLeft size={16} />
          {t('novels.detail.back')}
        </button>
        <h1 className="truncate font-semibold text-lg">{novel?.title}</h1>
        <span className="rounded-md bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">M10</span>
      </div>

      <Tabs defaultValue="chapters" className="flex min-h-0 flex-1 flex-col px-6 pb-6">
        <TabsList className="shrink-0 self-start">
          <TabsTrigger value="chapters">{t('novels.chapters.tab')}</TabsTrigger>
          <TabsTrigger value="entities">{t('novels.entities.tab')}</TabsTrigger>
          <TabsTrigger value="relations">{t('novels.relations.tab')}</TabsTrigger>
          <TabsTrigger value="timeline">{t('novels.timeline.tab')}</TabsTrigger>
        </TabsList>

        <TabsContent value="chapters" className="min-h-0 flex-1">
          <ChaptersM10Tab novelId={novelId} />
        </TabsContent>
        <TabsContent value="entities" className="min-h-0 flex-1">
          <EntitiesTab novelId={novelId} />
        </TabsContent>
        <TabsContent value="relations" className="min-h-0 flex-1">
          <RelationsTab novelId={novelId} />
        </TabsContent>
        <TabsContent value="timeline" className="min-h-0 flex-1">
          <TimelineTab novelId={novelId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default NovelM10DetailPage
