import NovelsPage from '@renderer/pages/novels/NovelsPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/novels/')({
  component: NovelsPage
})
