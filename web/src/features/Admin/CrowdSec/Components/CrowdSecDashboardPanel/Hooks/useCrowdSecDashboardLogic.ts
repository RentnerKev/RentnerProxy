import type { CrowdSecDashboardLogicResult } from '../Types/crowdsec-dashboard.types.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type {
    CrowdSecConfiguration,
    CrowdSecDashboard,
} from '@/lib/Admin/CrowdSec/Types/crowdsec.types.ts'
import type { CrowdSecDashboardQuery } from '@/lib/Admin/CrowdSec/Types/crowdsec.types.ts'
import { crowdSecQueryKeys } from '@/lib/Admin/CrowdSec/crowdSecCache.ts'
import { getCrowdSecDashboardHandler } from '../../../middleware.ts'
import useLiveQuery from '@/shared/Live/Hooks/useLiveQuery.ts'

export default function useCrowdSecDashboardLogic(
    configuration: CrowdSecConfiguration,
): CrowdSecDashboardLogicResult {
    const { locale } = useTranslationStore()
    const queryClient = useQueryClient()
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
    const queryKey = useMemo(
        () => [
            ...crowdSecQueryKeys.dashboard,
            configuration.runtime?.mode,
            configuration.runtime?.apiUrl,
            request,
        ],
        [configuration.runtime?.mode, configuration.runtime?.apiUrl, request],
    )
    const query = useQuery({
        queryKey,
        queryFn: () => getCrowdSecDashboardHandler({ data: request }),
        enabled,
        staleTime: Infinity,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: 1,
        placeholderData: (previous) => previous,
    })
    const onLiveData = useCallback(
        async (snapshot: CrowdSecDashboard) => {
            await queryClient.cancelQueries({ queryKey, exact: true })
            queryClient.setQueryData(queryKey, snapshot)
        },
        [queryClient, queryKey],
    )
    const liveStatus = useLiveQuery<CrowdSecDashboard>({
        topic: 'crowdsec-dashboard',
        query: request,
        enabled,
        onData: onLiveData,
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
        state: {
            enabled,
            snapshot,
            isFetching: query.isFetching,
            isError: query.isError || liveStatus === 'disconnected',
            collectedAtDisplay: snapshot
                ? new Date(snapshot.collectedAt * 1000).toLocaleTimeString(locale)
                : '',
            filters: { searchInput, origin, scope, pageIndex, pageSize },
        },
        handler: {
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
