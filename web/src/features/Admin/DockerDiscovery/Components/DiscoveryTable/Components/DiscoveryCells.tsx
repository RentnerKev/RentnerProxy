import { ActionMenu } from '@/shared/ActionMenu/index.tsx'
import { ProxyHostDomainsCell } from '@/features/Admin/ProxyHostManagement/Components/ProxyHostsTable/Components/ProxyHostTableCells.tsx'
import { formatProxyHostForward } from '@/lib/Admin/ProxyHostManagement/proxyHostTableCells.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { DiscoveryCellProps, DiscoveryTableProps } from '../../../Types/discovery-ui.types.ts'
import type { DiscoveryRow } from '@/lib/DockerDiscovery/Types/management.types.ts'

const statusColors: Record<DiscoveryRow['state'], string> = {
    create: 'bg-info-bg text-info-text',
    update: 'bg-info-bg text-info-text',
    current: 'bg-success-bg text-success-text',
    stopped: 'bg-warning-text/15 text-warning-text',
    orphaned: 'bg-warning-text/15 text-warning-text',
    conflicted: 'bg-danger-bg text-danger-text',
    unavailable: 'bg-danger-bg text-danger-text',
    detached: 'bg-neutral text-muted',
}

export function DiscoverySourceCell({ row }: DiscoveryCellProps) {
    return (
        <div className="grid max-w-64 gap-1">
            <span className="font-mono text-sm font-bold wrap-anywhere text-ink-soft">
                {row.sourceId}
            </span>
            <span className="font-mono text-xs text-muted">
                {row.containerId?.slice(0, 12) ?? '—'}
            </span>
        </div>
    )
}
export function DiscoveryDomainsCell({ row }: DiscoveryCellProps) {
    return <ProxyHostDomainsCell domains={row.domains} />
}
export function DiscoveryTargetCell({ row }: DiscoveryCellProps) {
    const { t } = useTranslationStore()
    return (
        <div className="grid max-w-64 gap-1">
            <span className="font-mono text-xs wrap-anywhere text-ink-soft">
                {row.target
                    ? formatProxyHostForward(row.target.scheme, row.target.address, row.target.port)
                    : t('admin.dockerDiscovery.table.savedTarget')}
            </span>
            {row.target ? <span className="text-xs text-muted">{row.target.network}</span> : null}
        </div>
    )
}
export function DiscoveryStatusCell({ row }: DiscoveryCellProps) {
    const { t } = useTranslationStore()
    return (
        <div className="grid max-w-72 justify-items-start gap-2">
            <DiscoveryStatusBadge state={row.state} />
            {row.issues.length ? (
                <span className="text-xs text-muted">
                    {t(`admin.dockerDiscovery.issues.${row.issues[0]}`)}
                    {row.issues.length > 1
                        ? ` ${t('admin.dockerDiscovery.table.moreIssues', { count: row.issues.length - 1 })}`
                        : ''}
                </span>
            ) : null}
        </div>
    )
}
export function DiscoveryStatusBadge({ state }: { readonly state: DiscoveryRow['state'] }) {
    const { t } = useTranslationStore()
    return (
        <span
            className={`inline-flex rounded-full px-[0.6rem] py-[0.3rem] text-[0.66rem] font-extrabold ${statusColors[state]}`}
        >
            {t(`admin.dockerDiscovery.states.${state}`)}
        </span>
    )
}
export function DiscoveryActionsCell({
    row,
    canDetach,
    locked,
    onDetails,
    onDetach,
}: DiscoveryCellProps &
    Pick<DiscoveryTableProps, 'canDetach' | 'locked' | 'onDetails' | 'onDetach'>) {
    const { t } = useTranslationStore()
    return (
        <ActionMenu
            ariaLabel={t('admin.dockerDiscovery.table.actionsFor', { name: row.sourceId })}
            items={[
                {
                    label: t('admin.dockerDiscovery.actions.details'),
                    id: 'details',
                    onSelect: () => onDetails(row),
                },
                ...(canDetach && row.hostId && row.state !== 'detached'
                    ? [
                          {
                              label: t('admin.dockerDiscovery.actions.detach'),
                              id: 'detach',
                              onSelect: () => onDetach(row),
                              disabled: locked,
                              destructive: true,
                          },
                      ]
                    : []),
            ]}
        />
    )
}
