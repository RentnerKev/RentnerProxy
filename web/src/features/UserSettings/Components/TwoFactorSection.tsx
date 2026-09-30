import { LoaderCircle, ShieldCheck, ShieldOff } from 'lucide-react'

import useTranslationStore from '../../../language/useTranslationStore'
import type { TwoFactorSectionProps } from '../Types/security-component-props.types'

export default function TwoFactorSection({
    status,
    isLoading,
    isPending,
    onEnableTotp,
    onDisableTotp,
    onRegenerateCodes,
}: TwoFactorSectionProps) {
    const { t } = useTranslationStore()
    const disabled = isPending || !status

    return (
        <section
            className="min-w-0 rounded-2xl border border-border bg-surface p-[clamp(1.15rem,4vw,1.75rem)] shadow-surface"
            aria-labelledby="two-factor-title"
            aria-busy={isPending || isLoading}
        >
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 flex-1 gap-3">
                    <ShieldCheck
                        aria-hidden="true"
                        className="mt-1 size-6 shrink-0 text-brand-text"
                    />
                    <div className="min-w-0">
                        <h2 id="two-factor-title" className="text-xl font-extrabold text-ink-soft">
                            {t('account.twoFactor.title')}
                        </h2>
                        <p className="mt-2 text-sm leading-relaxed text-muted">
                            {t('account.twoFactor.description')}
                        </p>
                    </div>
                </div>
                {status ? (
                    <span
                        className={`rounded-full border px-2.5 py-1 text-xs font-bold ${status.totpEnabled ? 'border-success-text/20 bg-success-bg text-success-text' : 'border-border bg-surface-raised text-muted'}`}
                    >
                        {t(
                            status.totpEnabled
                                ? 'account.twoFactor.enabled'
                                : 'account.twoFactor.disabled',
                        )}
                    </span>
                ) : null}
            </div>
            {isLoading ? (
                <output className="mt-6 flex items-center gap-2 text-sm text-muted">
                    <LoaderCircle
                        aria-hidden="true"
                        className="size-5 animate-spin text-brand-text motion-reduce:animate-none"
                    />
                    {t('account.security.loading')}
                </output>
            ) : (
                <div className="mt-6 rounded-xl border border-border bg-surface-subtle p-4">
                    <div className="flex flex-wrap gap-3">
                        {status?.totpEnabled ? (
                            <>
                                <button
                                    type="button"
                                    className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border-strong bg-surface-raised px-4 py-2 text-sm font-bold text-ink-soft transition-colors enabled:hover:border-accent-border enabled:hover:text-brand-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring disabled:cursor-not-allowed disabled:opacity-55 motion-reduce:transition-none"
                                    disabled={disabled}
                                    onClick={onRegenerateCodes}
                                >
                                    {t('account.twoFactor.regenerateRecoveryCodes')}
                                </button>
                                <button
                                    type="button"
                                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-danger-text/20 bg-danger-bg px-4 py-2 text-sm font-bold text-danger-text transition-colors enabled:hover:border-danger-text/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring disabled:cursor-not-allowed disabled:opacity-55 motion-reduce:transition-none"
                                    disabled={disabled}
                                    onClick={onDisableTotp}
                                >
                                    <ShieldOff aria-hidden="true" className="size-4 shrink-0" />
                                    {t('account.twoFactor.disable')}
                                </button>
                            </>
                        ) : (
                            <button
                                type="button"
                                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-4 py-2 text-sm font-extrabold text-accent-foreground transition-colors enabled:hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring disabled:cursor-not-allowed disabled:opacity-55 motion-reduce:transition-none"
                                disabled={disabled}
                                onClick={onEnableTotp}
                            >
                                {t('account.twoFactor.enable')}
                            </button>
                        )}
                    </div>
                    {status?.totpEnabled ? (
                        <p className="mt-4 text-sm text-muted">
                            {t('account.twoFactor.recoveryCodesAvailable', {
                                count: status.recoveryCodesRemaining,
                            })}
                        </p>
                    ) : null}
                </div>
            )}
        </section>
    )
}
