import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { ProviderConnectionStatusProps } from './Types/provider-connections.types.ts'

export default function ProviderConnectionStatus({ connection }: ProviderConnectionStatusProps) {
    const { t } = useTranslationStore()
    return (
        <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-xs font-bold ${
                connection.verification?.status === 'connected'
                    ? 'bg-success-bg text-success-text'
                    : connection.verification?.status === 'disconnected' ||
                        connection.verification?.status === 'failed'
                      ? 'bg-danger-bg text-danger-text'
                      : 'bg-surface-subtle text-muted'
            }`}
        >
            <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
            {t(`admin.providers.status.${connection.verification?.status ?? 'untested'}`)}
        </span>
    )
}
