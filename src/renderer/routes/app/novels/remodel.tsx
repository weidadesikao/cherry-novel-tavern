import RemodelWizardPage from '@renderer/pages/novels/remodel/RemodelWizardPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/novels/remodel')({
  component: RemodelWizardPage
})
