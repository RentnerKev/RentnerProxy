import HostAvailabilityBadge from '@/features/Admin/HostMonitoring/Components/HostAvailabilityBadge.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { ProxyHostMonitoringCellProps } from '../../../Types/host-monitoring-overview.types.ts'
import type { ProxyHostMonitoringRow } from '../../../Types/host-monitoring-overview.types.ts'
import { createContext, useContext } from 'react'

export const ProxyHostMonitoringContext = createContext<
    ReadonlyMap<string, ProxyHostMonitoringRow> | undefined
>(undefined)

export default function ProxyHostMonitoringCell({
    host,
    onMonitoring,
}: ProxyHostMonitoringCellProps) {
    const { t } = useTranslationStore()
    const view = useContext(ProxyHostMonitoringContext)?.get(host.id)
    return (
        <button
            type="button"
            className="grid cursor-pointer gap-1.5 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent-ring"
            aria-label={t('admin.hostMonitoring.open', {
                name: host.domains[0] ?? host.forwardHost,
            })}
            onClick={() => onMonitoring(host)}
        >
            <HostAvailabilityBadge availability={view?.availability ?? 'loading'} />
            {view?.checkedAt ? (
                <time dateTime={view.checkedAtIso ?? undefined} className="text-xs text-muted">
                    {view.checkedAt}
                </time>
            ) : null}
            {view?.duration ? (
                <span className="font-mono text-xs text-ink-soft">{view.duration}</span>
            ) : null}
        </button>
    )
}
