import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import { ManagedDomainLink, ManagedDomainOverflow } from '../../../../shared/Domain'
import { Tooltip } from '../../../../shared/Tooltip'
import { useDateFormatter } from '../../../../language/useTranslationStore'
import useTranslationStore from '../../../../language/useTranslationStore'
import { formatProxyHostCreatedAt, formatProxyHostForward } from '../Helpers/proxyHostTableCells'
import type {
    ProxyHostCreatedAtCellProps,
    ProxyHostDomainsCellProps,
    ProxyHostForwardCellProps,
    ProxyHostStatusCellProps,
} from '../Types/proxy-host-table.types'

const certificateJobStageToOperationStage = {
    preparing: 'queued',
    issuing: 'creating_order',
    applying: 'applying',
    applied: 'applied',
    failed: 'failed',
    needs_attention: 'needs_attention',
} as const

const statusBadgeClassName =
    'inline-flex rounded-full px-[0.6rem] py-[0.3rem] text-[0.66rem] font-extrabold data-[status=enabled]:bg-success-bg data-[status=enabled]:text-success-text data-[status=disabled]:bg-danger-bg data-[status=disabled]:text-danger-text'

function DomainChip({ domain }: { readonly domain: string }) {
    const chipClassName = uiClassNames.chip.item + ' inline-block max-w-56 truncate align-bottom'
    const isLong = domain.length > 28
    const chip = <ManagedDomainLink className={chipClassName} domain={domain} />

    return isLong ? <Tooltip content={domain}>{chip}</Tooltip> : chip
}

export function ProxyHostDomainsCell({ domains }: ProxyHostDomainsCellProps) {
    const { t } = useTranslationStore()
    const visibleDomains = domains.slice(0, 2)
    const extraDomains = domains.slice(2)

    if (visibleDomains.length === 0) {
        return <span className="text-muted">—</span>
    }

    return (
        <div className={uiClassNames.chip.row}>
            {visibleDomains.map((domain) => (
                <DomainChip domain={domain} key={domain} />
            ))}
            {extraDomains.length > 0 ? (
                <ManagedDomainOverflow
                    ariaLabel={t('common.moreDomains', { count: extraDomains.length })}
                    domains={extraDomains}
                />
            ) : null}
        </div>
    )
}

export function ProxyHostForwardCell({
    forwardHost,
    forwardPort,
    forwardScheme,
    verifyUpstreamTls,
}: ProxyHostForwardCellProps) {
    const { t } = useTranslationStore()
    return (
        <div className="grid justify-items-start gap-2">
            <span className="block max-w-64 wrap-anywhere font-mono text-[0.72rem] text-muted">
                {formatProxyHostForward(forwardScheme, forwardHost, forwardPort)}
            </span>
            {forwardScheme === 'https' && verifyUpstreamTls === false ? (
                <span className="inline-flex max-w-64 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs font-bold text-ink-soft">
                    {t('admin.proxyHosts.upstreamTls.verificationDisabled')}
                </span>
            ) : null}
        </div>
    )
}

export function ProxyHostStatusCell({ enabled, certificateJob }: ProxyHostStatusCellProps) {
    const { t } = useTranslationStore()
    const status = enabled ? 'enabled' : 'disabled'

    const certificateStage =
        certificateJob?.controllerStage ??
        (certificateJob ? certificateJobStageToOperationStage[certificateJob.stage] : null)
    return (
        <div className="grid justify-items-start gap-2">
            <span className={statusBadgeClassName} data-status={status}>
                {t('admin.proxyHosts.status.' + status)}
            </span>
            {certificateStage ? (
                <span className="text-xs font-semibold text-info-text">
                    {t(`admin.certificates.operationStages.${certificateStage}`)}
                </span>
            ) : null}
        </div>
    )
}

export function ProxyHostCreatedAtCell({ value }: ProxyHostCreatedAtCellProps) {
    const dateFormatter = useDateFormatter()

    return (
        <span className="whitespace-nowrap text-muted">
            {formatProxyHostCreatedAt(value, dateFormatter)}
        </span>
    )
}
