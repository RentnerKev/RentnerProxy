import PageAlert from '@/shared/PageAlerts/PageAlert.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { ManualDnsJobAlertProps } from './Types/manual-dns-job-alert.types.ts'

export default function ManualDnsJobAlert({
    message,
    certificateId,
    canViewCertificate,
}: ManualDnsJobAlertProps) {
    const { t } = useTranslationStore()
    return (
        <PageAlert
            severity="warning"
            title={t('admin.certificates.manualDns.title')}
            description={
                canViewCertificate
                    ? message
                    : `${message} · ${t('admin.certificates.manualDns.handoff')}`
            }
            action={
                canViewCertificate ? (
                    <a
                        className="font-bold underline"
                        href={
                            '/certificates?selectedCertificateId=' +
                            encodeURIComponent(certificateId)
                        }
                    >
                        {t('admin.certificates.manualDns.openDetails')}
                    </a>
                ) : undefined
            }
        />
    )
}
