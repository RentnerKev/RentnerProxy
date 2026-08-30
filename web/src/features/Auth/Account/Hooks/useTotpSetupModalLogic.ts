import { useForm } from '@tanstack/react-form'
import { useState } from 'react'

import { getValidationIssue } from '../../../../shared/Forms/Helpers/getFieldErrorMessage'
import type { TotpSetupFormValues } from '../Types/security.types'
import { totpCodeSchema, totpSetupFormSchema } from '../validation'

type TotpSetupStep = 'scan' | 'verify'

interface UseTotpSetupModalLogicOptions {
    readonly onClose: () => void
    readonly onConfirm: (code: string) => Promise<unknown>
}

export default function useTotpSetupModalLogic({
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
        state: { form, step },
        handler: {
            back: () => setStep('scan'),
            close,
            getCodeError: (value: string) => getValidationIssue(totpCodeSchema, value, 'code'),
            normalizeCode: (value: string) => value.replace(/\D/g, '').slice(0, 6),
            verify: () => setStep('verify'),
        },
    }
}
