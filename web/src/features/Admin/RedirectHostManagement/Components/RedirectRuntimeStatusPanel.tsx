import useTranslationStore from '../../../../language/useTranslationStore'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { RedirectRuntimeStatus } from '../Types/redirect-host-management.types'
interface Props {
    readonly canApply: boolean
    readonly isApplying: boolean
    readonly onApply: () => void
    readonly status: RedirectRuntimeStatus | undefined
}
export default function RedirectRuntimeStatusPanel({
    canApply,
    isApplying,
    onApply,
    status,
}: Props) {
    const { t } = useTranslationStore()
    const state = status?.state ?? 'unavailable'
    const showApply =
        canApply && status !== undefined && status.desiredRevision !== status.activeRevision
    if (state === 'synced' && !showApply) return null
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
            {showApply ? (
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
