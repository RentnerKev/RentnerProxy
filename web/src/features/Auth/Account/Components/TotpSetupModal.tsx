import { QRCodeSVG } from 'qrcode.react'
import type { ChangeEvent } from 'react'

import FieldError from '../../../../shared/Forms/FieldError'
import { Modal } from '../../../../shared/Modal'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import useTranslationStore from '../../../../language/useTranslationStore'
import useTotpSetupModalLogic from '../Hooks/useTotpSetupModalLogic'

interface TotpSetupModalProps {
    readonly setup: { challengeId: string; secret: string; otpAuthUrl: string } | null
    readonly isPending: boolean
    readonly errorMessage?: string | null
    readonly onConfirm: (code: string) => Promise<unknown>
    readonly onClose: () => void
}

export default function TotpSetupModal({
    setup,
    isPending,
    errorMessage,
    onConfirm,
    onClose,
}: TotpSetupModalProps) {
    const logic = useTotpSetupModalLogic({ onClose, onConfirm })
    const { t } = useTranslationStore()

    if (!setup) return null

    const isVerificationStep = logic.state.step === 'verify'
    return (
        <Modal
            open
            onOpenChange={(open) => {
                if (!open && !isPending) logic.handler.close()
            }}
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
                            className={uiClassNames.button.secondary}
                            disabled={isPending}
                            onClick={logic.handler.back}
                        >
                            {t('account.twoFactor.setup.back')}
                        </button>
                        <logic.state.form.Subscribe
                            selector={(formState) =>
                                [formState.canSubmit, formState.isSubmitting] as const
                            }
                        >
                            {([canSubmit, isSubmitting]) => (
                                <button
                                    type="button"
                                    className={uiClassNames.button.primary}
                                    disabled={!canSubmit || isSubmitting || isPending}
                                    onClick={() => void logic.state.form.handleSubmit()}
                                >
                                    {isSubmitting || isPending
                                        ? t('account.twoFactor.setup.verifying')
                                        : t('account.twoFactor.setup.verifyAndEnable')}
                                </button>
                            )}
                        </logic.state.form.Subscribe>
                    </>
                ) : (
                    <>
                        <button
                            type="button"
                            className={uiClassNames.button.secondary}
                            disabled={isPending}
                            onClick={logic.handler.close}
                        >
                            {t('common.cancel')}
                        </button>
                        <button
                            type="button"
                            className={uiClassNames.button.primary}
                            disabled={isPending}
                            onClick={logic.handler.verify}
                        >
                            {t('account.twoFactor.setup.continue')}
                        </button>
                    </>
                )
            }
        >
            <p className={uiClassNames.themedTechnicalLabel}>
                {t('account.twoFactor.setup.step', {
                    current: isVerificationStep ? 2 : 1,
                })}
            </p>
            {isVerificationStep ? (
                <form
                    className="mt-5 grid gap-4"
                    noValidate
                    onSubmit={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        void logic.state.form.handleSubmit()
                    }}
                >
                    <logic.state.form.Field
                        name="code"
                        validators={{
                            onBlur: ({ value }) => logic.handler.getCodeError(value),
                        }}
                    >
                        {(field) => (
                            <div className={uiClassNames.form.field}>
                                <label className={uiClassNames.form.label} htmlFor={field.name}>
                                    {t('account.twoFactor.setup.authenticatorCode')}
                                </label>
                                <input
                                    id={field.name}
                                    name={field.name}
                                    className={uiClassNames.form.control}
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
                    </logic.state.form.Field>
                    {errorMessage ? (
                        <p role="alert" className="text-sm text-danger-text">
                            {t(errorMessage)}
                        </p>
                    ) : null}
                </form>
            ) : (
                <div className="mt-5 grid gap-5 sm:grid-cols-[auto_1fr] sm:items-start">
                    <figure className="mx-auto rounded-xl bg-white p-4 sm:mx-0">
                        <QRCodeSVG value={setup.otpAuthUrl} size={176} aria-hidden="true" />
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
