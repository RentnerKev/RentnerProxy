import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import type { CrowdSecConfiguration } from '../../../../shared/Types/crowdsec.types'
import type { CrowdSecDashboardQuery } from '../../../../shared/Types/crowdsec.types'
import { crowdSecQueryKeys } from '../queryKeys'
import { getCrowdSecDashboardHandler } from '../server'

export default function useCrowdSecDashboardLogic(configuration: CrowdSecConfiguration) {
    const enabled =
        configuration.runtime?.enforcementActive === true ||
        (import.meta.env.DEV && configuration.mode !== 'disabled')
    const [searchInput, setSearchInput] = useState('')
    const [search, setSearch] = useState('')
    const [origin, setOrigin] = useState('')
    const [scope, setScope] = useState<CrowdSecDashboardQuery['scope']>('')
    const [pageIndex, setPageIndex] = useState(0)
    const [pageSize, setPageSize] = useState(15)
    useEffect(() => {
        const timeout = setTimeout(() => {
            setSearch(searchInput.trim())
            setPageIndex(0)
        }, 300)
        return () => clearTimeout(timeout)
    }, [searchInput])
    const request = useMemo<CrowdSecDashboardQuery>(
        () => ({ offset: pageIndex * pageSize, limit: pageSize, search, origin, scope }),
        [pageIndex, pageSize, search, origin, scope],
    )
    const query = useQuery({
        queryKey: [
            ...crowdSecQueryKeys.dashboard,
            configuration.runtime?.mode,
            configuration.runtime?.apiUrl,
            request,
        ],
        queryFn: () => getCrowdSecDashboardHandler({ data: request }),
        enabled,
        refetchInterval: 60_000,
        staleTime: 15_000,
        retry: 1,
        placeholderData: (previous) => previous,
    })
    const snapshot = enabled ? query.data : undefined
    useEffect(() => {
        const filteredTotal = snapshot?.decisions?.filteredTotal
        if (filteredTotal === undefined) return
        const lastPage = Math.max(Math.ceil(filteredTotal / pageSize) - 1, 0)
        if (pageIndex > lastPage) {
            const timeout = setTimeout(() => setPageIndex(lastPage), 0)
            return () => clearTimeout(timeout)
        }
    }, [snapshot, pageIndex, pageSize])
    return {
        enabled,
        query,
        snapshot,
        filters: { searchInput, origin, scope, pageIndex, pageSize },
        actions: {
            setSearchInput,
            setOrigin: (value: string) => {
                setOrigin(value)
                setPageIndex(0)
            },
            setScope: (value: CrowdSecDashboardQuery['scope']) => {
                setScope(value)
                setPageIndex(0)
            },
            setPageIndex,
            setPageSize: (value: number) => {
                setPageSize(value)
                setPageIndex(0)
            },
        },
    }
}
