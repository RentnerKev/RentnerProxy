import type { TotpSetupModalLogicResult } from '../Types/totp-setup-modal.types.ts'
import { useForm } from '@tanstack/react-form'
import { useState } from 'react'

import { getValidationIssue } from '@/lib/Forms/fieldErrors.ts'
import type { TotpSetupFormValues } from '../../../Types/security.types.ts'
import { totpCodeSchema, totpSetupFormSchema } from '../../../validation.ts'

type TotpSetupStep = 'scan' | 'verify'

interface UseTotpSetupModalLogicOptions {
    readonly isPending: boolean
    readonly onClose: () => void
    readonly onConfirm: (code: string) => Promise<unknown>
}

export default function useTotpSetupModalLogic({
    isPending,
    onClose,
    onConfirm,
}: UseTotpSetupModalLogicOptions) {
    const [step, setStep] = useState<TotpSetupStep>('scan')
    const defaultValues: TotpSetupFormValues = { code: '' }
    const form = useForm({
        defaultValues,
        validators: { onSubmit: totpSetupFormSchema },
        onSubmit: async ({ value }) => {
            await onConfirm(value.code)
        },
    })

    function close() {
        form.reset()
        setStep('scan')
        onClose()
    }

    return {
        form,
        state: { step },
        handler: {
            handleSubmit: (event) => {
                event.preventDefault()
                event.stopPropagation()
                void form.handleSubmit()
            },
            handleOpenChange: (open) => {
                if (!open && !isPending) close()
            },
            validateCode: ({ value }) => getValidationIssue(totpCodeSchema, value, 'code'),
            back: () => setStep('scan'),
            close,
            getCodeError: (value: string) => getValidationIssue(totpCodeSchema, value, 'code'),
            normalizeCode: (value: string) => value.replace(/\D/g, '').slice(0, 6),
            verify: () => setStep('verify'),
        },
    } satisfies TotpSetupModalLogicResult<typeof form>
}
