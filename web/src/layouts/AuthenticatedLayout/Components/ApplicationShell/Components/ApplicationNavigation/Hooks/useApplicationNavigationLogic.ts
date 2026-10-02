import type { ApplicationNavigationLogicResult } from '../Types/application-navigation.types.ts'
import { useRouterState } from '@tanstack/react-router'
import { useId, useState } from 'react'

import { NAVIGATION_GROUP_IDS } from '@/config/navigation.config.ts'
import { parseStoredNavigationGroupPreferences } from '@/lib/Navigation/navigationPreferences.ts'
import type { NavigationGroupId } from '@/shared/Types/navigation-config.types.ts'

import type {
    ApplicationNavigationItem,
    ApplicationNavigationProps,
} from '../../../Types/application-shell.types.ts'

const navigationGroups = [
    {
        id: 'operations',
        paths: ['/', '/proxy-hosts', '/redirect-hosts', '/certificates'],
    },
    {
        id: 'security',
        paths: ['/access-policies', '/security', '/crowdsec'],
    },
    {
        id: 'administration',
        paths: ['/users', '/roles'],
    },
    {
        id: 'records',
        paths: ['/audit-logs', '/proxy-access-logs', '/migration', '/npm-import'],
    },
] as const satisfies readonly {
    readonly id: NavigationGroupId
    readonly paths: readonly ApplicationNavigationItem['to'][]
}[]

export default function useApplicationNavigationLogic(
    items: readonly ApplicationNavigationItem[],
    groupPreferences: ApplicationNavigationProps['groupPreferences'] = {},
    onGroupChange?: ApplicationNavigationProps['onGroupChange'],
): ApplicationNavigationLogicResult {
    const pathname = useRouterState({ select: (state) => state.location.pathname })
    const instanceId = useId()
    const groups = navigationGroups
        .map((group) => ({
            id: group.id,
            items: group.paths.flatMap((path) => {
                const item = items.find((candidate) => candidate.to === path)
                return item ? [item] : []
            }),
        }))
        .filter((group) => group.items.length > 0)
    const activeGroupId = groups.find((group) =>
        group.items.some(
            (item) =>
                pathname === item.to || (item.to !== '/' && pathname.startsWith(`${item.to}/`)),
        ),
    )?.id
    const [expandedState, setExpandedState] = useState<{
        readonly pathname: string
        readonly ids: ReadonlySet<NavigationGroupId>
    }>(() => ({ pathname, ids: new Set([activeGroupId ?? 'operations']) }))
    const defaultExpandedGroupIds =
        expandedState.pathname === pathname || !activeGroupId
            ? expandedState.ids
            : new Set([...expandedState.ids, activeGroupId])
    const preferences = parseStoredNavigationGroupPreferences(groupPreferences)
    const expandedGroupIds = new Set(defaultExpandedGroupIds)
    for (const groupId of NAVIGATION_GROUP_IDS) {
        if (preferences[groupId] === true) expandedGroupIds.add(groupId)
        else if (preferences[groupId] === false) expandedGroupIds.delete(groupId)
    }

    return {
        state: { groups, activeGroupId, expandedGroupIds, instanceId },
        handler: {
            toggleGroup(id: NavigationGroupId) {
                if (onGroupChange) {
                    onGroupChange({ groupId: id, expanded: !expandedGroupIds.has(id) })
                    return
                }
                setExpandedState((current) => {
                    const next = new Set(current.ids)
                    if (current.pathname !== pathname && activeGroupId) next.add(activeGroupId)
                    if (next.has(id)) next.delete(id)
                    else next.add(id)
                    return { pathname, ids: next }
                })
            },
        },
    }
}
