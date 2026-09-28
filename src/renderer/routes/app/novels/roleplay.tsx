import RoleplayPage from '@renderer/pages/novels/roleplay/RoleplayPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/novels/roleplay')({
  component: RoleplayPage
})
