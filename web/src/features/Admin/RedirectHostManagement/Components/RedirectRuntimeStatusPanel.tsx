import useTranslationStore from '../../../../language/useTranslationStore'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { RedirectRuntimeStatus } from '../Types/redirect-host-management.types'
interface Props {
    readonly canApply: boolean
    readonly isError?: boolean
    readonly isApplying: boolean
    readonly isRetrying?: boolean
    readonly onApply: () => void
    readonly onRetry?: () => void
    readonly status: RedirectRuntimeStatus | undefined
}
export default function RedirectRuntimeStatusPanel({
    canApply,
    isError = false,
    isApplying,
    isRetrying = false,
    onApply,
    onRetry,
    status,
}: Props) {
    const { t } = useTranslationStore()
    const displayStatus = isError ? undefined : status
    const state = displayStatus?.state ?? 'unavailable'
    const showApply =
        canApply &&
        !isError &&
        displayStatus !== undefined &&
        displayStatus.desiredRevision !== displayStatus.activeRevision
    if (state === 'synced' && !showApply && !isError) return null
    return (
        <section
            className={`mb-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-[clamp(1rem,3vw,1.25rem)] ${state === 'synced' ? 'border-brand-600/25 bg-success-bg' : state === 'pending' ? 'border-amber-500/35 bg-amber-500/10' : 'border-red-500/30 bg-danger-bg'}`}
            aria-live="polite"
            aria-label={t('admin.redirectHosts.runtime.title')}
        >
            <div className="grid gap-1">
                <p className="m-0 text-sm font-extrabold text-ink-soft">
                    {t(`admin.redirectHosts.runtime.${state}`)}
                </p>
                <p className="m-0 text-sm leading-[1.45] text-muted">
                    {t(`admin.redirectHosts.runtime.${state}Description`)}
                </p>
            </div>
            {isError && onRetry ? (
                <button
                    type="button"
                    className={uiClassNames.button.secondary}
                    onClick={onRetry}
                    disabled={isRetrying}
                >
                    {t('common.retry')}
                </button>
            ) : showApply ? (
                <button
                    type="button"
                    className={uiClassNames.button.primary}
                    onClick={onApply}
                    disabled={isApplying}
                >
                    {t(
                        isApplying
                            ? 'admin.redirectHosts.runtime.applying'
                            : 'admin.redirectHosts.runtime.apply',
                    )}
                </button>
            ) : null}
        </section>
    )
}
