import { usePersistCache } from '@data/hooks/useCache'
import { usePreference } from '@data/hooks/usePreference'
import { AppLogo } from '@renderer/config/env'
import useAvatar from '@renderer/hooks/useAvatar'
import { useTabs } from '@renderer/hooks/useTabs'
import { getSidebarIconLabel } from '@renderer/i18n/label'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import type { SidebarIcon as SidebarIconType } from '@shared/data/preference/preferenceTypes'
import {
  BookMarked,
  BookOpen,
  Code,
  FileSearch,
  Folder,
  Languages,
  LayoutGrid,
  MessageCircle,
  MousePointerClick,
  NotepadText,
  Palette,
  Sparkle
} from 'lucide-react'
import type { Ref } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { OpenClawSidebarIcon } from '../Icons/SvgIcon'
import UserPopup from '../Popups/UserPopup'
import { Sidebar as UISidebar } from '../Sidebar'
import { getSidebarDisplayWidth, getSidebarLayout, normalizeSidebarWidth } from '../Sidebar/constants'
import type { SidebarMenuItem, SidebarUser } from '../Sidebar/types'

const APP_LOGO = <img src={AppLogo} alt="Cherry Studio" className="h-9 w-9 rounded-lg" draggable={false} />
const noop = () => {}

/**
 * `novels_m10` is a fork-local experimental entry (M10 chat-pipeline graft).
 * It is NOT part of the SidebarIcon preference enum — it's force-inserted
 * below the novels icon so existing installs see it without a preference
 * migration.
 */
type SidebarItemId = SidebarIconType | 'novels_m10'

const routePrefixMap: Record<SidebarItemId, string> = {
  assistants: '/app/chat',
  agents: '/app/agents',
  store: '/app/library',
  paintings: '/app/paintings',
  translate: '/app/translate',
  mini_app: '/app/mini-app',
  knowledge: '/app/knowledge',
  files: '/app/files',
  code_tools: '/app/code',
  notes: '/app/notes',
  novels: '/app/novels',
  novels_m10: '/app/novels-m10',
  openclaw: '/app/openclaw'
}

const iconMap: Record<SidebarItemId, SidebarMenuItem['icon']> = {
  assistants: MessageCircle,
  agents: MousePointerClick,
  store: Sparkle,
  paintings: Palette,
  translate: Languages,
  mini_app: LayoutGrid,
  knowledge: FileSearch,
  files: Folder,
  code_tools: Code,
  notes: NotepadText,
  novels: BookOpen,
  novels_m10: BookMarked,
  openclaw: OpenClawSidebarIcon
}

function getMenuPath(icon: SidebarItemId): string {
  return routePrefixMap[icon] || ''
}

function resolveActiveItem(pathname: string): SidebarItemId | '' {
  // `/app/novels-m10/...` must not light up the plain `novels` prefix — check
  // the more specific entry first (Object.entries order is insertion order,
  // but be explicit rather than rely on it).
  if (pathname === routePrefixMap.novels_m10 || pathname.startsWith(`${routePrefixMap.novels_m10}/`)) {
    return 'novels_m10'
  }
  const match = (Object.entries(routePrefixMap) as Array<[SidebarItemId, string]>).find(
    ([, prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
  return match?.[0] || ''
}

export default function Sidebar({ ref }: { ref?: Ref<HTMLDivElement | null> }) {
  const { t } = useTranslation()
  const [userName] = usePreference('app.user.name')
  const [visibleSidebarIcons] = usePreference('ui.sidebar.icons.visible')
  const { activeTab, updateTab, openTab } = useTabs()

  // Sidebar width — persisted across restarts. Dragging through the
  // intermediate 50-120px range uses a local preview width so the UI can
  // follow the cursor without persisting unstable widths.
  const [sidebarWidth, setSidebarWidth] = usePersistCache('ui.sidebar.width')
  const [previewSidebarWidth, setPreviewSidebarWidth] = useState<number | null>(null)
  const activeSidebarWidth = previewSidebarWidth ?? sidebarWidth

  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--sidebar-width', `${getSidebarDisplayWidth(activeSidebarWidth)}px`)
  }, [activeSidebarWidth])

  // Migration, not dead code: the resize path only persists normalized widths,
  // but older builds (three-state layout, default 65) persisted intermediate
  // values that must be collapsed once on load. Writing derived state back
  // cannot loop — normalizeSidebarWidth is idempotent and the write is guarded
  // by the inequality check. Skip while a drag preview is active so the
  // write-back does not clobber it.
  useEffect(() => {
    if (previewSidebarWidth !== null) return

    const normalizedWidth = normalizeSidebarWidth(sidebarWidth)
    if (normalizedWidth !== sidebarWidth) {
      setSidebarWidth(normalizedWidth)
    }
  }, [previewSidebarWidth, setSidebarWidth, sidebarWidth])

  // User avatar
  const avatar = useAvatar()
  const sidebarUser = useMemo<SidebarUser>(
    () => ({
      name: userName || t('chat.user', { defaultValue: t('export.user', { defaultValue: 'User' }) }),
      avatar: avatar || undefined,
      onClick: () => UserPopup.show()
    }),
    [avatar, t, userName]
  )

  // Floating sidebar (hover reveal when hidden)
  const [hoverVisible, setHoverVisible] = useState(false)
  const layout = getSidebarLayout(activeSidebarWidth)

  // Menu items
  const pathname = activeTab?.url || '/'

  const items = useMemo<SidebarMenuItem[]>(() => {
    const list = visibleSidebarIcons.flatMap((icon): SidebarMenuItem[] => {
      const path = getMenuPath(icon)
      const Icon = iconMap[icon]
      if (!path || !Icon) {
        return []
      }
      return [
        {
          id: icon,
          label: getSidebarIconLabel(icon),
          icon: Icon
        }
      ]
    })
    // Fork-local M10 entry: pinned right below the novels icon (appended when
    // novels is hidden) — not preference-driven, see SidebarItemId note.
    const m10Item: SidebarMenuItem = {
      id: 'novels_m10',
      label: getSidebarIconLabel('novels_m10'),
      icon: iconMap.novels_m10
    }
    const novelsIndex = list.findIndex((item) => item.id === 'novels')
    if (novelsIndex >= 0) {
      list.splice(novelsIndex + 1, 0, m10Item)
    } else {
      list.push(m10Item)
    }
    return list
  }, [visibleSidebarIcons])

  const activeItem = resolveActiveItem(pathname)

  const handleNavigate = useCallback(
    async (menuItemId: string) => {
      const menuId = menuItemId as SidebarItemId
      const path = getMenuPath(menuId)
      if (!path) return

      if (activeTab?.isPinned) {
        openTab(path, { forceNew: true, title: getDefaultRouteTitle(path) })
        return
      }

      if (activeTab && activeTab.id !== 'home') {
        // Reusing the active tab — clear any per-entity icon (e.g. a mini-app
        // logo carried over from /app/mini-app/<id>) so the new top-level
        // route falls back to its default Lucide icon.
        updateTab(activeTab.id, { url: path, title: getDefaultRouteTitle(path), icon: undefined })
      } else {
        openTab(path, { forceNew: true, title: getDefaultRouteTitle(path) })
      }
    },
    [activeTab, updateTab, openTab]
  )

  // Common props shared between normal and floating sidebar
  const sidebarProps = {
    activeItem,
    items,
    title: 'Cherry Studio',
    logo: APP_LOGO,
    user: sidebarUser,
    dockedTabs: [],
    onItemClick: handleNavigate,
    onCloseDockedTab: noop
  }

  return (
    <div ref={ref} id="app-sidebar" className="relative h-full [-webkit-app-region:no-drag]">
      <UISidebar
        width={activeSidebarWidth}
        setWidth={setSidebarWidth}
        onHoverChange={setHoverVisible}
        onResizePreview={setPreviewSidebarWidth}
        {...sidebarProps}
      />
      {hoverVisible && layout === 'hidden' && (
        <UISidebar
          width={activeSidebarWidth}
          setWidth={setSidebarWidth}
          isFloating
          onDismiss={() => setHoverVisible(false)}
          {...sidebarProps}
        />
      )}
    </div>
  )
}
