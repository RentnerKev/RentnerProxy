import { ActionMenu } from '../../../../shared/ActionMenu'
import useTranslationStore from '../../../../language/useTranslationStore'
import type { CertificateTableActionsProps } from '../Types/certificate-management.types'
import { hasActiveCertificateOperation } from '../Helpers/certificateOperations'

export default function CertificateTableActions({
    certificate,
    canDelete,
    canRenew,
    canUpdate,
    isPending,
    onDelete,
    onDetails,
    onRenew,
    onReplace,
}: CertificateTableActionsProps) {
    const { t } = useTranslationStore()
    const operationActive = hasActiveCertificateOperation(certificate)
    const items = [
        {
            label: t('admin.certificates.actions.details'),
            onSelect: () => onDetails(certificate),
            disabled: isPending,
        },
        ...(certificate.source === 'acme' && canRenew
            ? [
                  {
                      label: t(
                          certificate.candidate
                              ? 'admin.certificates.actions.retry'
                              : 'admin.certificates.actions.renew',
                      ),
                      onSelect: () => onRenew(certificate),
                      disabled: isPending || operationActive,
                  },
              ]
            : []),
        ...(certificate.source === 'manual' && canUpdate
            ? [
                  {
                      label: t('admin.certificates.actions.replace'),
                      onSelect: () => onReplace(certificate),
                      disabled: isPending || operationActive,
                  },
              ]
            : []),
        ...(canDelete
            ? [
                  {
                      label: t('admin.certificates.actions.delete'),
                      onSelect: () => onDelete(certificate),
                      disabled: isPending || operationActive,
                      destructive: true,
                  },
              ]
            : []),
    ]
    return (
        <ActionMenu
            items={items}
            ariaLabel={t('admin.certificates.actions.open', { name: certificate.name })}
        />
    )
}
