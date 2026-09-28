import NovelM10DetailPage from '@renderer/pages/novels-m10/NovelM10DetailPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/novels-m10/$novelId')({
  component: NovelM10DetailPage
})
