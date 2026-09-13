import { useMemo } from 'react'
import type { ProxyAccessLogsTableProps } from '../Types/proxy-access-logs.types'

export default function useProxyAccessLogsFilterOptions({
    availableHosts,
    availableStatuses,
    entries,
}: Pick<ProxyAccessLogsTableProps, 'availableHosts' | 'availableStatuses' | 'entries'>) {
    const hostOptions = useMemo(
        () =>
            [...new Set([...availableHosts, ...entries.map((entry) => entry.host)])].toSorted(
                (left, right) => left.localeCompare(right),
            ),
        [availableHosts, entries],
    )
    const statusOptions = useMemo(
        () =>
            [...new Set([...availableStatuses, ...entries.map((entry) => entry.status)])].toSorted(
                (left, right) => left - right,
            ),
        [availableStatuses, entries],
    )
    return { hostOptions, statusOptions }
}
