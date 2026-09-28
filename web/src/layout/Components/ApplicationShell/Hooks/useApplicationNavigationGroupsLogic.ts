import { useRouterState } from '@tanstack/react-router'
import { useId, useState } from 'react'

import type { ApplicationNavigationItem } from '../Types/application-shell.types'

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
    readonly id: string
    readonly paths: readonly ApplicationNavigationItem['to'][]
}[]

type NavigationGroupId = (typeof navigationGroups)[number]['id']

export default function useApplicationNavigationGroupsLogic(
    items: readonly ApplicationNavigationItem[],
) {
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
    const expandedGroupIds =
        expandedState.pathname === pathname || !activeGroupId
            ? expandedState.ids
            : new Set([...expandedState.ids, activeGroupId])

    return {
        groups,
        activeGroupId,
        expandedGroupIds,
        instanceId,
        toggleGroup(id: NavigationGroupId) {
            setExpandedState((current) => {
                const next = new Set(current.ids)
                if (current.pathname !== pathname && activeGroupId) next.add(activeGroupId)
                if (next.has(id)) next.delete(id)
                else next.add(id)
                return { pathname, ids: next }
            })
        },
    }
}
