import { Fingerprint, KeyRound, LoaderCircle, Pencil } from 'lucide-react'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { formatSecurityTimestamp } from '@/lib/UserSettings/security.ts'
import type { PasskeysSectionProps } from '../Types/security-component-props.types.ts'

export default function PasskeysSection({
    status,
    isLoading,
    isPending,
    onAddPasskey,
    onRenamePasskey,
    onRemovePasskey,
}: PasskeysSectionProps) {
    const { locale, t } = useTranslationStore()
    const passkeys = status?.passkeys ?? []
    const disabled = isPending || !status

    return (
        <section
            className="min-w-0 rounded-2xl border border-border bg-surface p-[clamp(1.15rem,4vw,1.75rem)] shadow-surface"
            aria-labelledby="passkeys-title"
            aria-busy={isLoading || isPending}
        >
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 flex-1 basis-64 gap-3">
                    <Fingerprint
                        aria-hidden="true"
                        className="mt-1 size-6 shrink-0 text-brand-text"
                    />
                    <div className="min-w-0">
                        <h2 id="passkeys-title" className="text-xl font-extrabold text-ink-soft">
                            {t('account.passkeys.title')}
                        </h2>
                        <p className="mt-2 text-sm leading-relaxed text-muted">
                            {t('account.passkeys.description')}
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-extrabold text-accent-foreground transition-colors enabled:hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring disabled:cursor-not-allowed disabled:opacity-55 motion-reduce:transition-none"
                    disabled={disabled}
                    onClick={onAddPasskey}
                >
                    <KeyRound aria-hidden="true" className="size-4" />
                    {t('account.passkeys.add')}
                </button>
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
                <div className="mt-6 rounded-xl border border-border bg-surface-subtle p-4 sm:p-5">
                    <h3 className="text-base font-extrabold text-ink-soft">
                        {t('account.passkeys.listTitle')}
                    </h3>
                    <div className="mt-4 grid gap-3">
                        {passkeys.length === 0 ? (
                            <p className="text-sm leading-relaxed text-muted">
                                {t('account.passkeys.empty')}
                            </p>
                        ) : (
                            passkeys.map((passkey) => (
                                <div
                                    key={passkey.id}
                                    className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface-raised p-4"
                                >
                                    <div className="flex min-w-0 flex-1 basis-56 items-start gap-3">
                                        <KeyRound
                                            aria-hidden="true"
                                            className="mt-0.5 size-5 shrink-0 text-muted"
                                        />
                                        <div className="min-w-0">
                                            <p className="font-bold wrap-anywhere text-ink-soft">
                                                {passkey.name}
                                            </p>
                                            <p className="mt-1 text-xs leading-relaxed text-muted">
                                                {t('account.passkeys.addedAt', {
                                                    date:
                                                        formatSecurityTimestamp(
                                                            passkey.createdAt,
                                                            locale,
                                                        ) ?? t('account.passkeys.unknownDate'),
                                                })}
                                            </p>
                                            {passkey.lastUsedAt ? (
                                                <p className="text-xs leading-relaxed text-muted">
                                                    {t('account.passkeys.lastUsedAt', {
                                                        date:
                                                            formatSecurityTimestamp(
                                                                passkey.lastUsedAt,
                                                                locale,
                                                            ) ?? t('account.passkeys.unknownDate'),
                                                    })}
                                                </p>
                                            ) : null}
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <button
                                            type="button"
                                            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border-strong px-3 py-2 text-sm font-bold text-ink-soft transition-colors enabled:hover:border-accent-border enabled:hover:text-brand-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring disabled:cursor-not-allowed disabled:opacity-55 motion-reduce:transition-none"
                                            disabled={disabled}
                                            onClick={() => onRenamePasskey(passkey.id)}
                                        >
                                            <Pencil aria-hidden="true" className="size-4" />
                                            {t('account.passkeys.rename')}
                                        </button>
                                        <button
                                            type="button"
                                            className="inline-flex min-h-11 items-center justify-center rounded-xl px-3 py-2 text-sm font-bold text-danger-text transition-colors enabled:hover:bg-danger-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring disabled:cursor-not-allowed disabled:opacity-55 motion-reduce:transition-none"
                                            disabled={disabled}
                                            onClick={() => onRemovePasskey(passkey.id)}
                                        >
                                            {t('account.passkeys.remove')}
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                    <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-muted">
                        <KeyRound aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                        {t('account.passkeys.hint')}
                    </p>
                </div>
            )}
        </section>
    )
}
