import NovelsM10Page from '@renderer/pages/novels-m10/NovelsM10Page'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/novels-m10/')({
  component: NovelsM10Page
})
