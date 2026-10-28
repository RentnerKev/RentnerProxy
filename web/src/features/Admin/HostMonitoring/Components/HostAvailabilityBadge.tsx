import {
    CheckCircle2,
    CircleHelp,
    Clock3,
    LoaderCircle,
    PauseCircle,
    TriangleAlert,
    XCircle,
} from 'lucide-react'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { HostAvailabilityBadgeProps } from '../Types/host-monitoring-dialog.types.ts'

export default function HostAvailabilityBadge({
    availability,
    className = '',
}: HostAvailabilityBadgeProps) {
    const { t } = useTranslationStore()
    return (
        <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-bold ${availability === 'healthy' ? 'border-success-text/20 bg-success-bg text-success-text' : availability === 'unhealthy' ? 'border-danger-text/20 bg-danger-bg text-danger-text' : 'border-border bg-surface-raised text-muted'} ${className}`}
        >
            {availability === 'healthy' ? (
                <CheckCircle2 aria-hidden="true" className="size-3.5" />
            ) : availability === 'unhealthy' ? (
                <XCircle aria-hidden="true" className="size-3.5" />
            ) : availability === 'loading' ? (
                <LoaderCircle aria-hidden="true" className="size-3.5" />
            ) : availability === 'stale' ? (
                <Clock3 aria-hidden="true" className="size-3.5" />
            ) : availability === 'disabled' || availability === 'host_disabled' ? (
                <PauseCircle aria-hidden="true" className="size-3.5" />
            ) : availability === 'domain_removed' || availability === 'unavailable' ? (
                <TriangleAlert aria-hidden="true" className="size-3.5" />
            ) : (
                <CircleHelp aria-hidden="true" className="size-3.5" />
            )}
            {t(`admin.hostMonitoring.states.${availability}`)}
        </span>
    )
}
