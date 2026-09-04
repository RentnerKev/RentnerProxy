import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import {
    useDateFormatter,
    default as useTranslationStore,
} from '../../../../language/useTranslationStore'
import { formatRedirectHostCreatedAt } from '../Helpers/redirectHostTableCells'
import type {
    RedirectHostCertificateCellProps,
    RedirectHostCreatedAtCellProps,
    RedirectHostDestinationCellProps,
    RedirectHostDomainsCellProps,
    RedirectHostStatusCellProps,
} from '../Types/redirect-host-table.types'
const badge =
    'inline-flex rounded-full px-[0.6rem] py-[0.3rem] text-[0.66rem] font-extrabold data-[status=enabled]:bg-success-bg data-[status=enabled]:text-success-text data-[status=disabled]:bg-danger-bg data-[status=disabled]:text-danger-text'
export function RedirectHostDomainsCell({ domains }: RedirectHostDomainsCellProps) {
    return domains.length ? (
        <div className={uiClassNames.chip.row}>
            {domains.slice(0, 2).map((domain) => (
                <span
                    className={uiClassNames.chip.item + ' inline-block max-w-56 truncate'}
                    key={domain}
                >
                    {domain}
                </span>
            ))}
            {domains.length > 2 ? (
                <span className={uiClassNames.chip.item}>+{domains.length - 2}</span>
            ) : null}
        </div>
    ) : (
        <span className="text-muted">—</span>
    )
}
export function RedirectHostDestinationCell({
    destination,
    statusCode,
    preserveRequestUri,
    certificateId,
}: RedirectHostDestinationCellProps) {
    const { t } = useTranslationStore()
    return (
        <div className="grid justify-items-start gap-2">
            <span className="max-w-[28rem] truncate font-mono text-[0.72rem] text-muted">
                {destination}
            </span>
            <span className="text-xs text-muted">
                {t('admin.redirectHosts.statusCodes.' + statusCode)} ·{' '}
                {preserveRequestUri
                    ? t('admin.redirectHosts.form.preserveRequestUri')
                    : t('admin.redirectHosts.form.replaceRequestUri')}{' '}
                ·{' '}
                {certificateId
                    ? t('admin.redirectHosts.cells.https')
                    : t('admin.redirectHosts.cells.http')}
            </span>
        </div>
    )
}
export function RedirectHostStatusCell({ enabled }: RedirectHostStatusCellProps) {
    const { t } = useTranslationStore()
    const status = enabled ? 'enabled' : 'disabled'
    return (
        <span className={badge} data-status={status}>
            {t('admin.redirectHosts.status.' + status)}
        </span>
    )
}
export function RedirectHostCertificateCell({ certificateId }: RedirectHostCertificateCellProps) {
    const { t } = useTranslationStore()
    return (
        <span className="text-sm text-muted">
            {certificateId
                ? t('admin.redirectHosts.cells.https')
                : t('admin.redirectHosts.cells.http')}
        </span>
    )
}
export function RedirectHostCreatedAtCell({ value }: RedirectHostCreatedAtCellProps) {
    const formatter = useDateFormatter()
    return (
        <span className="whitespace-nowrap text-muted">
            {formatRedirectHostCreatedAt(value, formatter)}
        </span>
    )
}
