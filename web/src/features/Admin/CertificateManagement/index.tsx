import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import TrustedCaManagementPage from '@/features/Admin/TrustedCaManagement/index.tsx'
import ServerCertificates from './Components/ServerCertificates/index.tsx'
import useCertificateWorkspaceLogic from './Hooks/useCertificateWorkspaceLogic.ts'
import type { CertificateManagementPageProps } from './Types/certificate-management.types.ts'

export default function CertificateManagementPage(props: CertificateManagementPageProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useCertificateWorkspaceLogic(props)
    return (
        <>
            <fieldset className="mb-5 flex flex-wrap gap-1 border-0 p-0">
                <legend className="sr-only">{t('admin.certificates.tabs.label')}</legend>
                {state.tabs.map((tab) => (
                    <button
                        key={tab.value}
                        type="button"
                        aria-pressed={state.active === tab.value}
                        className={
                            'rounded-lg px-4 py-2 text-sm font-bold outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent-ring ' +
                            (state.active === tab.value
                                ? 'bg-success-bg text-success-text'
                                : 'text-muted hover:bg-surface-hover')
                        }
                        onClick={() => handler.handleSelect(tab.value)}
                    >
                        {t(tab.label)}
                    </button>
                ))}
            </fieldset>
            {state.active === 'server' && state.canViewServers ? (
                <ServerCertificates {...props} />
            ) : state.canViewTrustedCas ? (
                <TrustedCaManagementPage {...props} />
            ) : null}
        </>
    )
}
