import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { ActionMenu } from '@/shared/ActionMenu/index.tsx'
import type { DdnsRecordCellProps, DdnsActionCellProps } from '../Types/ddns-table.types.ts'

export function DdnsNameCell({ row }: DdnsRecordCellProps) {
    return (
        <div className="flex items-center gap-3">
            <span className="rounded-md border border-accent-border bg-accent-muted px-2 py-1 font-mono text-xs font-bold text-accent-ring">
                {row.target.recordType}
            </span>
            <span className="font-mono text-sm font-semibold text-ink-soft">{row.target.name}</span>
        </div>
    )
}
export function DdnsConnectionCell({ row }: DdnsRecordCellProps) {
    return (
        <div className="grid gap-1">
            <span className="text-sm font-bold text-ink-soft">{row.connectionLabel}</span>
            <span className="font-mono text-xs text-muted">{row.zone}</span>
        </div>
    )
}
export function DdnsProxyCell({ row }: DdnsRecordCellProps) {
    const { t } = useTranslationStore()
    return (
        <span
            className={
                row.target.proxied ? 'text-sm font-bold text-accent-ring' : 'text-sm text-muted'
            }
        >
            {t(row.target.proxied ? 'admin.ddns.table.proxied' : 'admin.ddns.table.dnsOnly')}
        </span>
    )
}
export function DdnsStatusCell({ row }: DdnsRecordCellProps) {
    const { t } = useTranslationStore()
    return (
        <div className="grid max-w-64 gap-1">
            <span className="text-sm font-bold text-ink-soft">
                {t(`admin.ddns.results.${row.statusKey}`)}
            </span>
            <span className="font-mono text-xs text-muted">{row.address}</span>
            {row.error && !['family_disabled', 'target_disabled'].includes(row.error) ? (
                <span className="text-xs text-muted">
                    {t(`admin.ddns.recordErrors.${row.error}`)}
                </span>
            ) : null}
        </div>
    )
}
export function DdnsScheduleCell({ row }: DdnsRecordCellProps) {
    const { t } = useTranslationStore()
    return (
        <div className="grid gap-1 whitespace-nowrap text-xs text-muted">
            <span>{t('admin.ddns.table.last', { at: row.lastSuccess })}</span>
            <span>{t('admin.ddns.table.next', { at: row.nextAttempt })}</span>
        </div>
    )
}
export function DdnsActionsCell({
    row,
    canManage,
    locked,
    onEdit,
    onToggle,
    onDelete,
}: DdnsActionCellProps) {
    const { t } = useTranslationStore()
    return canManage ? (
        <ActionMenu
            ariaLabel={t('admin.ddns.table.actionsFor', {
                name: row.target.name,
                type: row.target.recordType,
            })}
            items={[
                { label: t('common.edit'), disabled: locked, onSelect: () => onEdit(row.target) },
                {
                    label: t(
                        row.target.enabled ? 'admin.ddns.table.disable' : 'admin.ddns.table.enable',
                    ),
                    disabled: locked,
                    onSelect: () => onToggle(row.target),
                },
                {
                    label: t('common.delete'),
                    destructive: true,
                    disabled: locked,
                    onSelect: () => onDelete(row.target),
                },
            ]}
        />
    ) : null
}
