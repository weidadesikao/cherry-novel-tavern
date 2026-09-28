import WriteWorkbenchM10Page from '@renderer/pages/novels-m10/write/WriteWorkbenchM10Page'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/novels-m10/write/$novelId/$chapterId')({
  component: WriteWorkbenchM10Page
})
