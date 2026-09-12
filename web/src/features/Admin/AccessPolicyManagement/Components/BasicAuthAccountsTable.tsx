import useTranslationStore, { useDateFormatter } from '../../../../language/useTranslationStore'
import { ActionMenu } from '../../../../shared/ActionMenu'
import { formatBasicAuthDate } from '../Helpers/basicAuthTableCells'
import type { BasicAuthAccountListProps } from '../Types/basic-auth.types'

export default function BasicAuthAccountsTable({
    accounts,
    canUpdate,
    isPending,
    onDelete,
    onEdit,
}: BasicAuthAccountListProps) {
    const { t } = useTranslationStore()
    const formatter = useDateFormatter()

    if (accounts.length === 0) {
        return (
            <div className="rounded-xl border border-dashed border-border-strong bg-surface-subtle p-5 text-sm leading-relaxed text-muted">
                {t('admin.accessPolicies.basicAuth.table.emptyDescription')}
            </div>
        )
    }

    return (
        <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
                <caption className="sr-only">
                    {t('admin.accessPolicies.basicAuth.table.caption')}
                </caption>
                <thead className="bg-surface-subtle text-xs font-extrabold uppercase tracking-[0.08em] text-muted">
                    <tr>
                        <th className="px-4 py-3" scope="col">
                            {t('admin.accessPolicies.basicAuth.columns.username')}
                        </th>
                        <th className="px-4 py-3" scope="col">
                            {t('admin.accessPolicies.basicAuth.columns.created')}
                        </th>
                        <th className="px-4 py-3" scope="col">
                            {t('admin.accessPolicies.basicAuth.columns.updated')}
                        </th>
                        {canUpdate ? (
                            <th
                                className="sticky right-0 z-10 bg-surface-subtle px-4 py-3 text-right"
                                scope="col"
                            >
                                {t('admin.accessPolicies.basicAuth.columns.actions')}
                            </th>
                        ) : null}
                    </tr>
                </thead>
                <tbody className="divide-y divide-border">
                    {accounts.map((account) => (
                        <tr key={account.id}>
                            <th className="px-4 py-3 font-extrabold text-ink-soft" scope="row">
                                <span className="block max-w-64 wrap-anywhere">
                                    {account.username}
                                </span>
                            </th>
                            <td className="whitespace-nowrap px-4 py-3 text-muted">
                                {formatBasicAuthDate(account.createdAt, formatter)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-muted">
                                {formatBasicAuthDate(account.updatedAt, formatter)}
                            </td>
                            {canUpdate ? (
                                <td className="sticky right-0 z-10 bg-surface px-4 py-3">
                                    <div className="flex justify-end gap-2">
                                        <ActionMenu
                                            openOnHover
                                            items={[
                                                {
                                                    label: t(
                                                        'admin.accessPolicies.basicAuth.actions.editAccount',
                                                    ),
                                                    disabled: isPending,
                                                    onSelect: () => onEdit(account),
                                                },
                                                {
                                                    label: t(
                                                        'admin.accessPolicies.basicAuth.actions.deleteAccount',
                                                    ),
                                                    destructive: true,
                                                    disabled: isPending,
                                                    onSelect: () => onDelete(account),
                                                },
                                            ]}
                                        />
                                    </div>
                                </td>
                            ) : null}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
