import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { DeliveryRow } from '../Types/notifications-panel.types.ts'

export function DeliveryChannelCell({ row }: { row: DeliveryRow }) {
    const { t } = useTranslationStore()
    return (
        <div className="grid min-w-0 gap-1 break-words [overflow-wrap:anywhere]">
            <span className="font-bold text-ink">{row.channelName}</span>
            <span className="text-xs text-muted">
                {t(`account.notifications.categories.${row.category}`)}
            </span>
            <span className="font-mono text-[0.65rem] text-muted" title={row.resourceId}>
                {row.resourceId}
            </span>
        </div>
    )
}
export function DeliveryHealthCell({ row }: { row: DeliveryRow }) {
    const { t } = useTranslationStore()
    return (
        <span
            className={`inline-flex max-w-full rounded-lg px-2 py-1 text-xs font-bold ${row.incidentState === 'active' ? 'bg-danger-bg text-danger-text' : row.incidentState === 'recovered' ? 'bg-success-bg text-success-text' : 'bg-surface-raised text-muted'}`}
        >
            {t(`account.notifications.incidentStates.${row.incidentState}`)}
        </span>
    )
}
export function DeliveryStatusCell({ row }: { row: DeliveryRow }) {
    const { t } = useTranslationStore()
    return (
        <div className="grid min-w-0 gap-1 break-words [overflow-wrap:anywhere]">
            <span
                className={`font-bold ${row.status === 'failed' ? 'text-danger-text' : row.status === 'succeeded' ? 'text-success-text' : 'text-ink-soft'}`}
            >
                {t(`account.notifications.deliveryStates.${row.status}`)}
            </span>
            {row.error ? (
                <span className="text-xs text-muted">
                    {t(`account.notifications.errors.${row.error}`)}
                </span>
            ) : null}
            <span className="text-xs text-muted">
                {t('account.notifications.attempts')}: {row.attempts}
            </span>
        </div>
    )
}
export function DeliveryDateCell({ row, locale }: { row: DeliveryRow; locale: string }) {
    return (
        <time
            dateTime={new Date(row.updatedAt).toISOString()}
            className="grid gap-1 text-xs text-muted"
        >
            <span>{new Date(row.updatedAt).toLocaleDateString(locale)}</span>
            <span>
                {new Date(row.updatedAt).toLocaleTimeString(locale, {
                    hour: '2-digit',
                    minute: '2-digit',
                })}
            </span>
        </time>
    )
}
