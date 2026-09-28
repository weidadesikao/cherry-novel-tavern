import NovelDetailPage from '@renderer/pages/novels/NovelDetailPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/novels/$novelId')({
  component: NovelDetailPage
})
