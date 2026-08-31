import { useState } from 'react'
import { PERMISSIONS } from '../../../config/permissions.config'
import useTranslationStore from '../../../language/useTranslationStore'
import TrustedCaManagementPage from '../TrustedCaManagement'
import CertificateManagementPageView from './Components/CertificateManagementPageView'
import useCertificateManagementLogic from './Hooks/useCertificateManagementLogic'
import type { CertificateManagementPageProps } from './Types/certificate-management.types'

function ServerCertificates(props: CertificateManagementPageProps) {
    return <CertificateManagementPageView logic={useCertificateManagementLogic(props)} />
}

export default function CertificateManagementPage(props: CertificateManagementPageProps) {
    const { t } = useTranslationStore()
    const canViewServers = props.permissions.includes(PERMISSIONS.CERTIFICATES_VIEW)
    const canViewTrustedCas = props.permissions.includes(PERMISSIONS.TRUSTED_CAS_VIEW)
    const [selected, setSelected] = useState<'server' | 'trusted'>(
        canViewServers ? 'server' : 'trusted',
    )
    const active =
        selected === 'trusted' && canViewTrustedCas
            ? 'trusted'
            : canViewServers
              ? 'server'
              : 'trusted'
    return (
        <>
            <fieldset className="mb-5 flex flex-wrap gap-1 border-0 p-0">
                <legend className="sr-only">{t('admin.certificates.tabs.label')}</legend>
                {[
                    {
                        value: 'server' as const,
                        allowed: canViewServers,
                        label: 'admin.certificates.tabs.server',
                    },
                    {
                        value: 'trusted' as const,
                        allowed: canViewTrustedCas,
                        label: 'admin.certificates.tabs.trusted',
                    },
                ]
                    .filter((tab) => tab.allowed)
                    .map((tab) => (
                        <button
                            key={tab.value}
                            type="button"
                            aria-pressed={active === tab.value}
                            className={
                                'rounded-lg px-4 py-2 text-sm font-bold outline-offset-2 focus-visible:outline-2 focus-visible:outline-brand-500 ' +
                                (active === tab.value
                                    ? 'bg-success-bg text-success-text'
                                    : 'text-muted hover:bg-surface-hover')
                            }
                            onClick={() => setSelected(tab.value)}
                        >
                            {t(tab.label)}
                        </button>
                    ))}
            </fieldset>
            {active === 'server' && canViewServers ? (
                <ServerCertificates {...props} />
            ) : canViewTrustedCas ? (
                <TrustedCaManagementPage {...props} />
            ) : null}
        </>
    )
}
