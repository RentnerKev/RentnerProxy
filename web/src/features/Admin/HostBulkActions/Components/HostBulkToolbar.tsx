import { BULK_HOST_LIMITS } from '@/config/bulk-hosts.config.ts'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import HostBulkModal from './HostBulkModal.tsx'
import type { BulkHostToolbarProps } from '../Types/bulk-hosts-ui.types.ts'

export default function HostBulkToolbar(props: BulkHostToolbarProps) {
    const { t } = useTranslationStore()
    return (
        <>
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-raised p-3">
                <output className="mr-auto text-sm text-muted">
                    {t('admin.bulkHosts.selected', {
                        count: props.ids.length,
                        limit: BULK_HOST_LIMITS.hosts,
                    })}
                </output>
                <button
                    type="button"
                    className={buttonClassName('secondary')}
                    disabled={props.disabled || props.open}
                    onClick={props.onSelectPage}
                >
                    {t('admin.bulkHosts.selectPage')}
                </button>
                <button
                    type="button"
                    className={buttonClassName('secondary')}
                    disabled={props.disabled || props.open || !props.ids.length}
                    onClick={props.onClear}
                >
                    {t('admin.bulkHosts.clear')}
                </button>
                <button
                    type="button"
                    className={buttonClassName('primary')}
                    disabled={props.disabled || !props.ids.length}
                    aria-haspopup="dialog"
                    aria-expanded={props.open}
                    onClick={() => props.onOpenChange(true)}
                >
                    {t('admin.bulkHosts.open')}
                </button>
            </div>
            {props.open ? (
                <HostBulkModal
                    kind={props.kind}
                    permissions={props.permissions}
                    hostIds={props.ids}
                    onOpenChange={props.onOpenChange}
                />
            ) : null}
        </>
    )
}
