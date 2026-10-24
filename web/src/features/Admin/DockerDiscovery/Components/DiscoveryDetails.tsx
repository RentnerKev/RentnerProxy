import { ModalCancelButton } from '@/shared/Modal/Components/ModalActions.tsx'
import { Link } from '@tanstack/react-router'
import { Modal } from '@/shared/Modal/index.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { formatProxyHostForward } from '@/lib/Admin/ProxyHostManagement/proxyHostTableCells.ts'
import type { DiscoveryDetailsProps } from '../Types/discovery-ui.types.ts'
export default function DiscoveryDetails({ row, candidate, onClose }: DiscoveryDetailsProps) {
    const { t } = useTranslationStore()
    return (
        <Modal
            open
            onOpenChange={onClose}
            title={t('admin.dockerDiscovery.actions.details')}
            description={row.sourceId}
            footer={
                <ModalCancelButton type="button" onClick={onClose}>
                    {t('common.close')}
                </ModalCancelButton>
            }
        >
            <dl className="grid gap-4 text-sm">
                <div>
                    <dt className="text-xs text-muted">
                        {t('admin.dockerDiscovery.table.status')}
                    </dt>
                    <dd className="mt-1 font-bold text-ink-soft">
                        {t(`admin.dockerDiscovery.states.${row.state}`)}
                    </dd>
                </div>
                <div>
                    <dt className="text-xs text-muted">
                        {t('admin.dockerDiscovery.table.domains')}
                    </dt>
                    <dd className="mt-1 grid gap-1 font-mono wrap-anywhere text-ink-soft">
                        {row.domains.map((domain) => (
                            <span key={domain}>{domain}</span>
                        ))}
                    </dd>
                </div>
                <div>
                    <dt className="text-xs text-muted">
                        {t('admin.dockerDiscovery.table.target')}
                    </dt>
                    <dd className="mt-1 font-mono wrap-anywhere text-ink-soft">
                        {row.target
                            ? formatProxyHostForward(
                                  row.target.scheme,
                                  row.target.address,
                                  row.target.port,
                              )
                            : t('admin.dockerDiscovery.table.savedTarget')}
                    </dd>
                </div>
                <div>
                    <dt className="text-xs text-muted">
                        {t('admin.dockerDiscovery.details.container')}
                    </dt>
                    <dd className="mt-1 font-mono wrap-anywhere text-ink-soft">
                        {row.containerId ?? '—'}
                    </dd>
                </div>
                <div>
                    <dt className="text-xs text-muted">
                        {t('admin.dockerDiscovery.details.certificate')}
                    </dt>
                    <dd className="mt-1 font-mono wrap-anywhere text-ink-soft">
                        {candidate?.certificateId ?? '—'}
                    </dd>
                </div>
                <div>
                    <dt className="text-xs text-muted">
                        {t('admin.dockerDiscovery.details.accessPolicy')}
                    </dt>
                    <dd className="mt-1 font-mono wrap-anywhere text-ink-soft">
                        {candidate?.accessPolicyId ?? '—'}
                    </dd>
                </div>
                <div>
                    <dt className="text-xs text-muted">
                        {t('admin.dockerDiscovery.details.tlsName')}
                    </dt>
                    <dd className="mt-1 font-mono wrap-anywhere text-ink-soft">
                        {candidate?.upstreamTlsServerName ?? '—'}
                    </dd>
                </div>
            </dl>
            {row.issues.length ? (
                <ul className="mt-5 grid gap-2 text-sm text-muted">
                    {row.issues.map((issue) => (
                        <li key={issue}>{t(`admin.dockerDiscovery.issues.${issue}`)}</li>
                    ))}
                </ul>
            ) : null}
            {row.hostId ? (
                <p className="mt-5 text-sm text-muted">
                    {row.state !== 'detached'
                        ? t('admin.dockerDiscovery.details.managedHint')
                        : null}{' '}
                    <Link to="/proxy-hosts" className="font-bold text-accent-ring underline">
                        {t('shell.proxyHosts')}
                    </Link>
                </p>
            ) : null}
        </Modal>
    )
}
