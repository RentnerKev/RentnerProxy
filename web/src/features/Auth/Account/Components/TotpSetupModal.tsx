import { QRCodeSVG } from 'qrcode.react'
import type { ChangeEvent } from 'react'

import FieldError from '../../../../shared/Forms/FieldError'
import { Modal } from '../../../../shared/Modal'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
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

    if (!setup) return null

    const isVerificationStep = logic.state.step === 'verify'
    return (
        <Modal
            open
            onOpenChange={(open) => {
                if (!open && !isPending) logic.handler.close()
            }}
            title={isVerificationStep ? 'Verify authenticator' : 'Set up authenticator app'}
            description={
                isVerificationStep
                    ? 'Enter the six-digit code from your authenticator app.'
                    : 'Scan the QR code or enter the setup key in your authenticator app.'
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
                            Back
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
                                    {isSubmitting || isPending ? 'Verifying…' : 'Verify and enable'}
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
                            Cancel
                        </button>
                        <button
                            type="button"
                            className={uiClassNames.button.primary}
                            disabled={isPending}
                            onClick={logic.handler.verify}
                        >
                            Continue
                        </button>
                    </>
                )
            }
        >
            <p className={uiClassNames.themedTechnicalLabel}>
                Step {isVerificationStep ? '2' : '1'} of 2
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
                                    Authenticator code
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
                            {errorMessage}
                        </p>
                    ) : null}
                </form>
            ) : (
                <div className="mt-5 grid gap-5 sm:grid-cols-[auto_1fr] sm:items-start">
                    <figure className="mx-auto rounded-xl bg-white p-4 sm:mx-0">
                        <QRCodeSVG value={setup.otpAuthUrl} size={176} aria-hidden="true" />
                        <figcaption className="sr-only">Authenticator setup QR code</figcaption>
                    </figure>
                    <div className="grid gap-4">
                        <p className="text-sm leading-relaxed text-muted">
                            Can’t scan the QR code? Enter this setup key manually:
                        </p>
                        <code className="break-all rounded-lg border border-border bg-surface-raised p-3 text-sm text-ink-soft">
                            {setup.secret}
                        </code>
                        <p className="text-sm leading-relaxed text-muted">
                            Keep this dialog open until your authenticator has saved the account.
                        </p>
                    </div>
                </div>
            )}
        </Modal>
    )
}
