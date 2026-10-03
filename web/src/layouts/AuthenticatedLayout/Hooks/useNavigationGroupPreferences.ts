import type { NavigationGroupMutation } from '../Types/navigation-group-preferences.types.ts'
import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from '@rentnerkev/toasts/toast'

import { parseStoredNavigationGroupPreferences } from '@/lib/Navigation/navigationPreferences.ts'
import type {
    NavigationGroupChange,
    NavigationGroupId,
} from '@/config/Types/navigation-config.types.ts'
import { updateCurrentUserNavigationGroupHandler } from '@/features/UserSettings/middleware.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'

export default function useNavigationGroupPreferences(
    user: Pick<AuthenticatedUser, 'id' | 'navigationGroupPreferences'>,
) {
    const { t } = useTranslationStore()
    const [preferences, setPreferences] = useState(() =>
        parseStoredNavigationGroupPreferences(user.navigationGroupPreferences),
    )
    const confirmed = useRef(preferences)
    const desired = useRef(preferences)
    const latestChanges = useRef<Partial<Record<NavigationGroupId, number>>>({})
    const nextVersion = useRef(0)
    const active = useRef(true)

    useEffect(() => {
        active.current = true
        return () => {
            active.current = false
        }
    }, [])

    function restoreGroup({ groupId, version }: NavigationGroupMutation): boolean {
        if (!active.current || latestChanges.current[groupId] !== version) return false
        const restored = { ...desired.current }
        if (confirmed.current[groupId] === undefined) delete restored[groupId]
        else restored[groupId] = confirmed.current[groupId]
        desired.current = restored
        setPreferences(restored)
        return true
    }

    const mutation = useMutation({
        scope: { id: `navigation-groups:${user.id}` },
        retry: false,
        mutationFn: ({ groupId, expanded }: NavigationGroupMutation) =>
            active.current
                ? updateCurrentUserNavigationGroupHandler({
                      data: { expectedUserId: user.id, groupId, expanded },
                  })
                : Promise.resolve({
                      success: false as const,
                      message: 'shell.navigationSaveFailed',
                  }),
        onSuccess: (result, change) => {
            if (result.success) {
                confirmed.current = { ...confirmed.current, [result.groupId]: result.expanded }
            } else if (restoreGroup(change)) {
                toast.error(t(result.message), { title: t('toast.titles.error') })
            }
        },
        onError: (_error, change) => {
            if (restoreGroup(change)) {
                toast.error(t('shell.navigationSaveFailed'), { title: t('toast.titles.error') })
            }
        },
    })

    return {
        preferences,
        updateGroup(change: NavigationGroupChange) {
            if (desired.current[change.groupId] === change.expanded) return
            const version = ++nextVersion.current
            latestChanges.current[change.groupId] = version
            desired.current = { ...desired.current, [change.groupId]: change.expanded }
            setPreferences(desired.current)
            mutation.mutate({ ...change, version })
        },
    }
}
