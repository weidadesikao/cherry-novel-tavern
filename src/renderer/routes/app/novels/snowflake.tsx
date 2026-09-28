import SnowflakeWizardPage from '@renderer/pages/novels/snowflake/SnowflakeWizardPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/novels/snowflake')({
  component: SnowflakeWizardPage,
  // Working title handed over from the create-novel dialog.
  validateSearch: (search: Record<string, unknown>): { title?: string } => ({
    title: typeof search.title === 'string' && search.title ? search.title : undefined
  })
})
