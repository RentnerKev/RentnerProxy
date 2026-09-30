import { useRouteContext, useSearch } from '@tanstack/react-router'

export default function useUserSettingsRoute() {
    const { user } = useRouteContext({ from: '/_authenticated/account' })
    const { section } = useSearch({ from: '/_authenticated/account' })

    return { user, activeSection: section }
}
