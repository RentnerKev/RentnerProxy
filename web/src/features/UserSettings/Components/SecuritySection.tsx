import { Fingerprint, KeyRound, LoaderCircle, ShieldCheck, ShieldOff } from 'lucide-react'

import useTranslationStore from '../../../language/useTranslationStore'
import { formatSecurityTimestamp } from '../Helpers/security'
import type { SecurityStatus } from '../Types/security.types'

interface SecuritySectionProps {
    readonly status: SecurityStatus | undefined
    readonly isLoading: boolean
    readonly isPending: boolean
    readonly onEnableTotp: () => void
    readonly onAddPasskey: () => void
    readonly onDisableTotp: () => void
    readonly onRegenerateCodes: () => void
    readonly onRenamePasskey: (id: string) => void
    readonly onRemovePasskey: (id: string) => void
}

export default function SecuritySection({
    status,
    isLoading,
    isPending,
    onEnableTotp,
    onAddPasskey,
    onDisableTotp,
    onRegenerateCodes,
    onRenamePasskey,
    onRemovePasskey,
}: SecuritySectionProps) {
    const { locale, t } = useTranslationStore()

    if (isLoading)
        return (
            <section
                className="min-w-0 rounded-2xl border border-border bg-surface p-[clamp(1.15rem,4vw,1.75rem)] shadow-surface"
                aria-busy="true"
            >
                <LoaderCircle
                    className="size-5 animate-spin text-accent-ring"
                    aria-label={t('account.security.loading')}
                />
            </section>
        )
    const passkeys = status?.passkeys ?? []
    return (
        <section
            className="min-w-0 rounded-2xl border border-border bg-surface p-[clamp(1.15rem,4vw,1.75rem)] shadow-surface"
            aria-labelledby="security-title"
            aria-busy={isPending}
        >
            <p className="m-0 font-mono text-[0.68rem] font-bold tracking-[0.16em] text-accent-ring uppercase">
                {t('account.security.sectionEyebrow')}
            </p>
            <h2 id="security-title" className="mt-[0.6rem] text-xl text-ink-soft">
                {t('account.security.title')}
            </h2>
            <div className="mt-6 grid gap-5">
                <div className="rounded-xl border border-border-strong bg-surface-raised p-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex gap-3">
                            <ShieldCheck
                                aria-hidden="true"
                                className="mt-1 size-5 text-accent-ring"
                            />
                            <div>
                                <h3 className="font-bold text-ink-soft">
                                    {t('account.twoFactor.title')}
                                </h3>
                                <p className="mt-1 text-sm text-muted">
                                    {t('account.twoFactor.description')}
                                </p>
                            </div>
                        </div>
                        <span className="rounded-full border border-border px-2 py-1 text-xs text-muted">
                            {status?.totpEnabled
                                ? t('account.twoFactor.enabled')
                                : t('account.twoFactor.disabled')}
                        </span>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                        {status?.totpEnabled ? (
                            <>
                                <button
                                    type="button"
                                    className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-accent-border enabled:hover:text-accent-ring"
                                    disabled={isPending}
                                    onClick={onRegenerateCodes}
                                >
                                    {t('account.twoFactor.regenerateRecoveryCodes')}
                                </button>
                                <button
                                    type="button"
                                    className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-red-700/25 bg-danger-bg text-danger-text enabled:hover:border-red-500/45 enabled:hover:bg-red-700/20"
                                    disabled={isPending}
                                    onClick={onDisableTotp}
                                >
                                    <ShieldOff aria-hidden="true" className="size-4" />
                                    {t('account.twoFactor.disable')}
                                </button>
                            </>
                        ) : (
                            <button
                                type="button"
                                className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-accent text-accent-foreground enabled:hover:bg-accent-hover"
                                disabled={isPending}
                                onClick={onEnableTotp}
                            >
                                {t('account.twoFactor.enable')}
                            </button>
                        )}
                    </div>
                    {status?.totpEnabled ? (
                        <p className="mt-3 text-sm text-muted">
                            {t('account.twoFactor.recoveryCodesAvailable', {
                                count: status.recoveryCodesRemaining,
                            })}
                        </p>
                    ) : null}
                </div>
                <div className="rounded-xl border border-border-strong bg-surface-raised p-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex gap-3">
                            <Fingerprint
                                aria-hidden="true"
                                className="mt-1 size-5 text-accent-ring"
                            />
                            <div>
                                <h3 className="font-bold text-ink-soft">
                                    {t('account.passkeys.title')}
                                </h3>
                                <p className="mt-1 text-sm text-muted">
                                    {t('account.passkeys.description')}
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-accent text-accent-foreground enabled:hover:bg-accent-hover"
                            disabled={isPending}
                            onClick={onAddPasskey}
                        >
                            <KeyRound aria-hidden="true" className="size-4" />
                            {t('account.passkeys.add')}
                        </button>
                    </div>
                    <div className="mt-4 grid gap-2">
                        {passkeys.length === 0 ? (
                            <p className="text-sm text-muted">{t('account.passkeys.empty')}</p>
                        ) : (
                            passkeys.map((passkey) => (
                                <div
                                    key={passkey.id}
                                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-3"
                                >
                                    <div>
                                        <p className="font-bold text-ink-soft">{passkey.name}</p>
                                        <p className="text-xs text-muted">
                                            {t('account.passkeys.addedAt', {
                                                date:
                                                    formatSecurityTimestamp(
                                                        passkey.createdAt,
                                                        locale,
                                                    ) ?? t('account.passkeys.unknownDate'),
                                            })}
                                            {passkey.lastUsedAt
                                                ? ` · ${t('account.passkeys.lastUsedAt', {
                                                      date:
                                                          formatSecurityTimestamp(
                                                              passkey.lastUsedAt,
                                                              locale,
                                                          ) ?? t('account.passkeys.unknownDate'),
                                                  })}`
                                                : ''}
                                        </p>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-transparent text-muted enabled:hover:border-accent-border enabled:hover:text-accent-ring"
                                            disabled={isPending}
                                            onClick={() => onRenamePasskey(passkey.id)}
                                        >
                                            {t('account.passkeys.rename')}
                                        </button>
                                        <button
                                            type="button"
                                            className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-red-700/25 bg-danger-bg text-danger-text enabled:hover:border-red-500/45 enabled:hover:bg-red-700/20"
                                            disabled={isPending}
                                            onClick={() => onRemovePasskey(passkey.id)}
                                        >
                                            {t('account.passkeys.remove')}
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </section>
    )
}
