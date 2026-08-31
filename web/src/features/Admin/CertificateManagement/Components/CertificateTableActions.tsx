import { ActionMenu } from '../../../../shared/ActionMenu'
import useTranslationStore from '../../../../language/useTranslationStore'
import type { CertificateTableActionsProps } from '../Types/certificate-management.types'

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
    const items = [
        {
            label: t('admin.certificates.actions.details'),
            onSelect: () => onDetails(certificate),
            disabled: isPending,
        },
        ...(certificate.source === 'acme' && canRenew
            ? [
                  {
                      label: t('admin.certificates.actions.renew'),
                      onSelect: () => onRenew(certificate),
                      disabled: isPending,
                  },
              ]
            : []),
        ...(certificate.source === 'manual' && canUpdate
            ? [
                  {
                      label: t('admin.certificates.actions.replace'),
                      onSelect: () => onReplace(certificate),
                      disabled: isPending,
                  },
              ]
            : []),
        ...(canDelete
            ? [
                  {
                      label: t('admin.certificates.actions.delete'),
                      onSelect: () => onDelete(certificate),
                      disabled: isPending,
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
