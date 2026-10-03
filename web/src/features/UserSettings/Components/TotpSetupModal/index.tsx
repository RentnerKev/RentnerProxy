import type { TotpSetupModalProps } from './Types/totp-setup-modal-props.types.ts'
import { TextInput } from '@rentnerkev/inputs'
import { QRCode } from 'react-qr-code'
import type { ChangeEvent } from 'react'

import FieldError from '@/shared/Forms/FieldError.tsx'
import { Modal } from '@/shared/Modal/index.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useTotpSetupModalLogic from './Hooks/useTotpSetupModalLogic.ts'

export default function TotpSetupModal({
    setup,
    isPending,
    onConfirm,
    onClose,
}: TotpSetupModalProps) {
    const logic = useTotpSetupModalLogic({ isPending, onClose, onConfirm })
    const { t } = useTranslationStore()

    if (!setup) return null

    const isVerificationStep = logic.state.step === 'verify'
    return (
        <Modal
            open
            onOpenChange={logic.handler.handleOpenChange}
            title={
                isVerificationStep
                    ? t('account.twoFactor.setup.verifyTitle')
                    : t('account.twoFactor.setup.title')
            }
            description={
                isVerificationStep
                    ? t('account.twoFactor.setup.verifyDescription')
                    : t('account.twoFactor.setup.description')
            }
            closeDisabled={isPending}
            footer={
                isVerificationStep ? (
                    <>
                        <button
                            type="button"
                            className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-accent-border enabled:hover:text-accent-ring"
                            disabled={isPending}
                            onClick={logic.handler.back}
                        >
                            {t('account.twoFactor.setup.back')}
                        </button>
                        <logic.form.Subscribe
                            selector={(formState) =>
                                [formState.canSubmit, formState.isSubmitting] as const
                            }
                        >
                            {([canSubmit, isSubmitting]) => (
                                <button
                                    type="button"
                                    className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-accent text-accent-foreground enabled:hover:bg-accent-hover"
                                    disabled={!canSubmit || isSubmitting || isPending}
                                    onClick={() => void logic.form.handleSubmit()}
                                >
                                    {isSubmitting || isPending
                                        ? t('account.twoFactor.setup.verifying')
                                        : t('account.twoFactor.setup.verifyAndEnable')}
                                </button>
                            )}
                        </logic.form.Subscribe>
                    </>
                ) : (
                    <>
                        <button
                            type="button"
                            className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-accent-border enabled:hover:text-accent-ring"
                            disabled={isPending}
                            onClick={logic.handler.close}
                        >
                            {t('common.cancel')}
                        </button>
                        <button
                            type="button"
                            className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-accent text-accent-foreground enabled:hover:bg-accent-hover"
                            disabled={isPending}
                            onClick={logic.handler.verify}
                        >
                            {t('account.twoFactor.setup.continue')}
                        </button>
                    </>
                )
            }
        >
            <p className="m-0 font-mono text-[0.68rem] font-bold tracking-[0.16em] text-accent-ring uppercase">
                {t('account.twoFactor.setup.step', {
                    current: isVerificationStep ? 2 : 1,
                })}
            </p>
            {isVerificationStep ? (
                <form className="mt-5 grid gap-4" noValidate onSubmit={logic.handler.handleSubmit}>
                    <logic.form.Field
                        name="code"
                        validators={{
                            onBlur: logic.handler.validateCode,
                        }}
                    >
                        {(field) => (
                            <div className="grid gap-[0.45rem]">
                                <label
                                    className="text-[0.82rem] font-[750] text-ink-soft"
                                    htmlFor={field.name}
                                >
                                    {t('account.twoFactor.setup.authenticatorCode')}
                                </label>
                                <TextInput
                                    id={field.name}
                                    name={field.name}
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    maxLength={6}
                                    value={field.state.value}
                                    onBlur={field.handleBlur}
                                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                        field.handleChange(
                                            logic.handler.normalizeCode(event.target.value),
                                        )
                                    }
                                    aria-describedby={`${field.name}-error`}
                                />
                                <FieldError
                                    id={`${field.name}-error`}
                                    errors={field.state.meta.errors}
                                />
                            </div>
                        )}
                    </logic.form.Field>
                </form>
            ) : (
                <div className="mt-5 grid gap-5 sm:grid-cols-[auto_1fr] sm:items-start">
                    <figure className="mx-auto rounded-xl bg-white p-4 sm:mx-0">
                        <QRCode value={setup.otpAuthUrl} size={176} level="L" aria-hidden="true" />
                        <figcaption className="sr-only">
                            {t('account.twoFactor.setup.qrCode')}
                        </figcaption>
                    </figure>
                    <div className="grid gap-4">
                        <p className="text-sm leading-relaxed text-muted">
                            {t('account.twoFactor.setup.manualKey')}
                        </p>
                        <code className="break-all rounded-lg border border-border bg-surface-raised p-3 text-sm text-ink-soft">
                            {setup.secret}
                        </code>
                        <p className="text-sm leading-relaxed text-muted">
                            {t('account.twoFactor.setup.keepOpen')}
                        </p>
                    </div>
                </div>
            )}
        </Modal>
    )
}
