import { useForm } from '@tanstack/react-form'
import { useId, useState } from 'react'
import useToast from '../../../../shared/Toast/Hooks/useToast'
import { createTrustedCaHandler, replaceTrustedCaHandler } from '../server'
import { createTrustedCaInputSchema } from '../validation'
import type { TrustedCaImportModalProps } from '../Types/trusted-ca-management.types'

export default function useTrustedCaImportLogic({
    trustedCa,
    onSuccess,
}: TrustedCaImportModalProps) {
    const toast = useToast()
    const formId = useId()
    const [isPending, setIsPending] = useState(false)
    const form = useForm({
        defaultValues: { name: trustedCa?.name ?? '', pem: '' },
        validators: { onSubmit: createTrustedCaInputSchema },
        onSubmit: async ({ value }) => {
            if (isPending) return
            setIsPending(true)
            try {
                const data = createTrustedCaInputSchema.parse(value)
                const result = trustedCa
                    ? await replaceTrustedCaHandler({
                          data: { ...data, trustedCaId: trustedCa.id },
                      })
                    : await createTrustedCaHandler({ data })
                if (!result.success) {
                    toast.error(result.message)
                    return
                }
                form.reset()
                if (result.runtimeStatus === 'pending')
                    toast.warning('admin.trustedCas.messages.savedPending')
                else toast.success(result.message)
                await onSuccess()
            } catch {
                toast.error('admin.trustedCas.errors.saveFailed')
            } finally {
                setIsPending(false)
            }
        },
    })
    return { form, formId, isPending }
}
