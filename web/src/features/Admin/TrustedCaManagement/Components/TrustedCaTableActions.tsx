import { ActionMenu } from '../../../../shared/ActionMenu'
import useTranslationStore from '../../../../language/useTranslationStore'
import type { TrustedCaSummary } from '../../../../shared/Types/trusted-cas.types'
import type { TrustedCaTableProps } from '../Types/trusted-ca-management.types'

export default function TrustedCaTableActions({
    trustedCa,
    canDelete,
    canUpdate,
    isPending,
    onDelete,
    onReplace,
}: Pick<TrustedCaTableProps, 'canDelete' | 'canUpdate' | 'isPending' | 'onDelete' | 'onReplace'> & {
    readonly trustedCa: TrustedCaSummary
}) {
    const { t } = useTranslationStore()
    const items = [
        ...(canUpdate
            ? [
                  {
                      label: t('admin.trustedCas.actions.replace'),
                      onSelect: () => onReplace(trustedCa),
                      disabled: isPending,
                  },
              ]
            : []),
        ...(canDelete
            ? [
                  {
                      label: t(
                          trustedCa.assignedHostCount > 0
                              ? 'admin.trustedCas.actions.deleteInUse'
                              : 'admin.trustedCas.actions.delete',
                      ),
                      onSelect: () => onDelete(trustedCa),
                      disabled: isPending || trustedCa.assignedHostCount > 0,
                      destructive: true,
                  },
              ]
            : []),
    ]
    return items.length > 0 ? (
        <ActionMenu
            items={items}
            ariaLabel={t('admin.trustedCas.actions.open', { name: trustedCa.name })}
        />
    ) : null
}
