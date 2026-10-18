import type { RuntimeStatusPanelProps } from './Types/runtime-status.types.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useRuntimeStatusPanelLogic from './Hooks/useRuntimeStatusPanelLogic.ts'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'

const statusStyles: Record<'synced' | 'pending' | 'unavailable', string> = {
    synced: 'border-success-text/25 bg-success-bg',
    pending: 'border-amber-500/35 bg-amber-500/10',
    unavailable: 'border-red-500/30 bg-danger-bg',
}

export default function RuntimeStatusPanel({
    canApply,
    isError = false,
    isApplying,
    isRetrying = false,
    onApply,
    onRetry,
    status,
    translationPrefix,
    showStatusDot = true,
}: RuntimeStatusPanelProps) {
    const { t } = useTranslationStore()
    const {
        state: { runtimeState, showApply, hidden },
    } = useRuntimeStatusPanelLogic({ canApply, isError, status })
    if (hidden) return null

    return (
        <section
            className={`mb-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-[clamp(1rem,3vw,1.25rem)] ${statusStyles[runtimeState]}`}
            aria-live="polite"
            aria-label={t(`${translationPrefix}.title`)}
        >
            <div className={showStatusDot ? 'flex min-w-0 items-start gap-3' : undefined}>
                {showStatusDot ? (
                    <span
                        className={`mt-1 size-2.5 shrink-0 rounded-full ${runtimeState === 'synced' ? 'bg-success-text' : runtimeState === 'pending' ? 'bg-amber-400' : 'bg-red-400'}`}
                        aria-hidden="true"
                    />
                ) : null}
                <div className="grid gap-1">
                    <p className="m-0 text-sm font-extrabold text-ink-soft">
                        {t(`${translationPrefix}.${runtimeState}`)}
                    </p>
                    <p className="m-0 text-sm leading-[1.45] text-muted">
                        {t(`${translationPrefix}.${runtimeState}Description`)}
                    </p>
                </div>
            </div>
            {isError && onRetry ? (
                <button
                    type="button"
                    className={buttonClassName('secondary')}
                    onClick={onRetry}
                    disabled={isRetrying}
                >
                    {t('common.retry')}
                </button>
            ) : showApply ? (
                <button
                    type="button"
                    className={buttonClassName('primary')}
                    onClick={onApply}
                    disabled={isApplying}
                >
                    {t(isApplying ? `${translationPrefix}.applying` : `${translationPrefix}.apply`)}
                </button>
            ) : null}
        </section>
    )
}
