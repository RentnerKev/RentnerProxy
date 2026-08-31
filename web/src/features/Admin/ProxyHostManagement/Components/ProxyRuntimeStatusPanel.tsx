import useTranslationStore from '../../../../language/useTranslationStore'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { ProxyRuntimeState, ProxyRuntimeStatus } from '../Types/proxy-host-management.types'

interface ProxyRuntimeStatusPanelProps {
    readonly canApply: boolean
    readonly isApplying: boolean
    readonly onApply: () => void
    readonly status: ProxyRuntimeStatus | undefined
}

const statusStyles: Record<ProxyRuntimeState, string> = {
    synced: 'border-brand-600/25 bg-success-bg',
    pending: 'border-amber-500/35 bg-amber-500/10',
    unavailable: 'border-red-500/30 bg-danger-bg',
}

export default function ProxyRuntimeStatusPanel({
    canApply,
    isApplying,
    onApply,
    status,
}: ProxyRuntimeStatusPanelProps) {
    const { t } = useTranslationStore()
    const state = status?.state ?? 'unavailable'
    const showApply =
        canApply && status !== undefined && status.desiredRevision !== status.activeRevision

    if (state === 'synced' && !showApply) return null

    return (
        <section
            className={`mb-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-[clamp(1rem,3vw,1.25rem)] ${statusStyles[state]}`}
            aria-live="polite"
            aria-label={t('admin.proxyHosts.runtime.title')}
        >
            <div className="flex min-w-0 items-start gap-3">
                <span
                    className={`mt-1 size-2.5 shrink-0 rounded-full ${state === 'synced' ? 'bg-brand-500' : state === 'pending' ? 'bg-amber-400' : 'bg-red-400'}`}
                    aria-hidden="true"
                />
                <div className="grid gap-1">
                    <p className="m-0 text-sm font-extrabold text-ink-soft">
                        {t(`admin.proxyHosts.runtime.${state}`)}
                    </p>
                    <p className="m-0 text-sm leading-[1.45] text-muted">
                        {t(`admin.proxyHosts.runtime.${state}Description`)}
                    </p>
                </div>
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
                            ? 'admin.proxyHosts.runtime.applying'
                            : 'admin.proxyHosts.runtime.apply',
                    )}
                </button>
            ) : null}
        </section>
    )
}
