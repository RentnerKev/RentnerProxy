import { useForm } from '@tanstack/react-form'
import { useId, useState } from 'react'
import { toast } from '@rentnerkev/toasts/toast'
import useTranslationStore from '../../../../language/useTranslationStore'
import { createTrustedCaHandler, replaceTrustedCaHandler } from '../server'
import { createTrustedCaInputSchema } from '../validation'
import type { TrustedCaImportModalProps } from '../Types/trusted-ca-management.types'

export default function useTrustedCaImportLogic({
    trustedCa,
    onSuccess,
}: TrustedCaImportModalProps) {
    const { t } = useTranslationStore()
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
                    toast.error(t(result.message), { title: t('toast.titles.error') })
                    return
                }
                form.reset()
                if (result.runtimeStatus === 'pending')
                    toast.warning(t('admin.trustedCas.messages.savedPending'), {
                        title: t('toast.titles.warning'),
                    })
                else toast.success(t(result.message), { title: t('toast.titles.success') })
                await onSuccess()
            } catch {
                toast.error(t('admin.trustedCas.errors.saveFailed'), {
                    title: t('toast.titles.error'),
                })
            } finally {
                setIsPending(false)
            }
        },
    })
    return { form, formId, isPending }
}
