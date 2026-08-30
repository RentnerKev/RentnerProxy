import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
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

const statusBadgeClassName =
    'inline-flex rounded-full px-[0.6rem] py-[0.3rem] text-[0.66rem] font-extrabold data-[status=enabled]:bg-success-bg data-[status=enabled]:text-success-text data-[status=disabled]:bg-danger-bg data-[status=disabled]:text-danger-text'

function DomainChip({ domain }: { readonly domain: string }) {
    const { t } = useTranslationStore()
    const chipClassName = uiClassNames.chip.item + ' inline-block max-w-56 truncate align-bottom'
    const isLong = domain.length > 28
    const chip = <span className={chipClassName}>{domain}</span>

    return isLong ? (
        <Tooltip content={domain}>
            <button
                type="button"
                aria-label={t('admin.proxyHosts.cells.showDomain', { domain })}
                className="inline-block max-w-56 cursor-help truncate rounded-full border-0 bg-transparent p-0 text-left outline-hidden focus-visible:outline-2 focus-visible:outline-brand-500"
            >
                {chip}
            </button>
        </Tooltip>
    ) : (
        chip
    )
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
                <Tooltip content={extraDomains.join(', ')}>
                    <button
                        type="button"
                        aria-label={t('admin.proxyHosts.cells.moreDomains', {
                            count: extraDomains.length,
                        })}
                        className="inline-flex cursor-help items-center rounded-full border-0 bg-neutral px-[0.6rem] py-[0.28rem] font-mono text-[0.65rem] font-bold text-muted outline-hidden focus-visible:outline-2 focus-visible:outline-brand-500"
                    >
                        +{extraDomains.length}
                    </button>
                </Tooltip>
            ) : null}
        </div>
    )
}

export function ProxyHostForwardCell({
    forwardHost,
    forwardPort,
    forwardScheme,
}: ProxyHostForwardCellProps) {
    return (
        <span className="whitespace-nowrap font-mono text-[0.72rem] text-muted">
            {formatProxyHostForward(forwardScheme, forwardHost, forwardPort)}
        </span>
    )
}

export function ProxyHostStatusCell({ enabled }: ProxyHostStatusCellProps) {
    const { t } = useTranslationStore()
    const status = enabled ? 'enabled' : 'disabled'

    return (
        <span className={statusBadgeClassName} data-status={status}>
            {t('admin.proxyHosts.status.' + status)}
        </span>
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
