import type { ActionMenuItem } from '../../../../shared/ActionMenu'
import type { Translate } from '../../../../language/useTranslationStore'
import type { ProxyHostTableActionsProps } from '../Types/proxy-host-table.types'
import { isCertificateJobActive } from '../../../../config/certificate-jobs.config'

function getProxyHostName(host: ProxyHostTableActionsProps['host']): string {
    return host.domains[0] ?? host.forwardHost
}

export function getProxyHostTableActionItems(
    {
        canDelete,
        canDisable,
        canRequestCertificate,
        canEnable,
        canUpdate,
        isPending,
        onConfig,
        onDelete,
        onDisable,
        onEdit,
        onEnable,
        onRequestCertificate,
        host,
    }: ProxyHostTableActionsProps,
    t: Translate,
): Array<ActionMenuItem> {
    const name = getProxyHostName(host)
    const items: Array<ActionMenuItem> = []

    if (canUpdate) {
        items.push({
            label: t('admin.proxyHosts.actions.edit'),
            onSelect: () => onEdit(host),
            disabled: isPending,
        })
    }

    if (canRequestCertificate && canUpdate && onRequestCertificate) {
        const job = host.certificateJob
        const retrying = Boolean(
            job &&
            (job.stage === 'failed' ||
                job.stage === 'needs_attention' ||
                (isCertificateJobActive(job.stage) && job.lastErrorCode !== null)),
        )
        items.push({
            label: t(
                retrying
                    ? 'admin.certificates.actions.retry'
                    : 'admin.certificates.actions.requestForHost',
            ),
            onSelect: () => onRequestCertificate(host),
            disabled: isPending || (job !== null && job !== undefined && !retrying),
        })
    }

    if (onConfig) {
        items.push({
            label: t('admin.proxyHosts.actions.config'),
            onSelect: () => onConfig(host),
            disabled: isPending,
        })
    }

    if (host.enabled && canDisable) {
        items.push({
            label: t('admin.proxyHosts.actions.disable'),
            onSelect: () => onDisable(host),
            destructive: true,
            disabled: isPending,
            description: t('admin.proxyHosts.actions.disableDescription'),
        })
    }

    if (!host.enabled && canEnable) {
        items.push({
            label: t('admin.proxyHosts.actions.enable'),
            onSelect: () => onEnable(host),
            disabled: isPending,
            description: t('admin.proxyHosts.actions.enableDescription'),
        })
    }

    if (canDelete) {
        items.push({
            label: t('admin.proxyHosts.actions.delete'),
            onSelect: () => onDelete(host),
            destructive: true,
            disabled: isPending,
            description: t('admin.proxyHosts.actions.deleteDescription', { name }),
        })
    }

    return items
}
