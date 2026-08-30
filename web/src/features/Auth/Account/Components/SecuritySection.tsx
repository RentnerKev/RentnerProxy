import { Fingerprint, KeyRound, LoaderCircle, ShieldCheck, ShieldOff } from 'lucide-react'

import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
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
    if (isLoading)
        return (
            <section className={uiClassNames.management.card} aria-busy="true">
                <LoaderCircle
                    className="size-5 animate-spin text-brand-text"
                    aria-label="Loading security settings"
                />
            </section>
        )
    const passkeys = status?.passkeys ?? []
    return (
        <section
            className={uiClassNames.management.card}
            aria-labelledby="security-title"
            aria-busy={isPending}
        >
            <p className={uiClassNames.themedTechnicalLabel}>Account protection</p>
            <h2 id="security-title" className="mt-[0.6rem] text-xl text-ink-soft">
                Security
            </h2>
            <div className="mt-6 grid gap-5">
                <div className="rounded-xl border border-border-strong bg-surface-raised p-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex gap-3">
                            <ShieldCheck
                                aria-hidden="true"
                                className="mt-1 size-5 text-brand-text"
                            />
                            <div>
                                <h3 className="font-bold text-ink-soft">
                                    Two-factor authentication
                                </h3>
                                <p className="mt-1 text-sm text-muted">
                                    Protect sign-ins with an authenticator app.
                                </p>
                            </div>
                        </div>
                        <span className="rounded-full border border-border px-2 py-1 text-xs text-muted">
                            {status?.totpEnabled ? 'Enabled' : 'Disabled'}
                        </span>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                        {status?.totpEnabled ? (
                            <>
                                <button
                                    type="button"
                                    className={uiClassNames.button.secondary}
                                    disabled={isPending}
                                    onClick={onRegenerateCodes}
                                >
                                    Regenerate recovery codes
                                </button>
                                <button
                                    type="button"
                                    className={uiClassNames.button.danger}
                                    disabled={isPending}
                                    onClick={onDisableTotp}
                                >
                                    <ShieldOff aria-hidden="true" className="size-4" />
                                    Disable 2FA
                                </button>
                            </>
                        ) : (
                            <button
                                type="button"
                                className={uiClassNames.button.primary}
                                disabled={isPending}
                                onClick={onEnableTotp}
                            >
                                Enable two-factor authentication
                            </button>
                        )}
                    </div>
                    {status?.totpEnabled ? (
                        <p className="mt-3 text-sm text-muted">
                            Recovery codes available: {status.recoveryCodesRemaining}
                        </p>
                    ) : null}
                </div>
                <div className="rounded-xl border border-border-strong bg-surface-raised p-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex gap-3">
                            <Fingerprint
                                aria-hidden="true"
                                className="mt-1 size-5 text-brand-text"
                            />
                            <div>
                                <h3 className="font-bold text-ink-soft">Passkeys</h3>
                                <p className="mt-1 text-sm text-muted">
                                    Use Windows Hello, Touch ID, security keys, or password
                                    managers.
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            className={uiClassNames.button.primary}
                            disabled={isPending}
                            onClick={onAddPasskey}
                        >
                            <KeyRound aria-hidden="true" className="size-4" />
                            Add passkey
                        </button>
                    </div>
                    <div className="mt-4 grid gap-2">
                        {passkeys.length === 0 ? (
                            <p className="text-sm text-muted">No passkeys have been added yet.</p>
                        ) : (
                            passkeys.map((passkey) => (
                                <div
                                    key={passkey.id}
                                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-3"
                                >
                                    <div>
                                        <p className="font-bold text-ink-soft">{passkey.name}</p>
                                        <p className="text-xs text-muted">
                                            Added {formatSecurityTimestamp(passkey.createdAt)}
                                            {passkey.lastUsedAt
                                                ? ` · Last used ${formatSecurityTimestamp(passkey.lastUsedAt)}`
                                                : ''}
                                        </p>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            className={uiClassNames.button.quiet}
                                            disabled={isPending}
                                            onClick={() => onRenamePasskey(passkey.id)}
                                        >
                                            Rename
                                        </button>
                                        <button
                                            type="button"
                                            className={uiClassNames.button.danger}
                                            disabled={isPending}
                                            onClick={() => onRemovePasskey(passkey.id)}
                                        >
                                            Remove
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
