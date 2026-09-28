import WriteWorkbenchPage from '@renderer/pages/novels/write/WriteWorkbenchPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/novels/write/$novelId/$chapterId')({
  component: WriteWorkbenchPage
})
