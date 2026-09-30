import useTranslationStore from '../../../../language/useTranslationStore'
import type { ProxyRuntimeState, ProxyRuntimeStatus } from '../Types/proxy-host-management.types'

interface ProxyRuntimeStatusPanelProps {
    readonly canApply: boolean
    readonly isError?: boolean
    readonly isApplying: boolean
    readonly isRetrying?: boolean
    readonly onApply: () => void
    readonly onRetry?: () => void
    readonly status: ProxyRuntimeStatus | undefined
}

const statusStyles: Record<ProxyRuntimeState, string> = {
    synced: 'border-brand-600/25 bg-success-bg',
    pending: 'border-amber-500/35 bg-amber-500/10',
    unavailable: 'border-red-500/30 bg-danger-bg',
}

export default function ProxyRuntimeStatusPanel({
    canApply,
    isError = false,
    isApplying,
    isRetrying = false,
    onApply,
    onRetry,
    status,
}: ProxyRuntimeStatusPanelProps) {
    const { t } = useTranslationStore()
    if (status === undefined && !isError) return null
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
            {isError && onRetry ? (
                <button
                    type="button"
                    className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-brand-600 enabled:hover:text-brand-text"
                    onClick={onRetry}
                    disabled={isRetrying}
                >
                    {t('common.retry')}
                </button>
            ) : showApply ? (
                <button
                    type="button"
                    className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-accent text-accent-foreground enabled:hover:bg-accent-hover"
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
