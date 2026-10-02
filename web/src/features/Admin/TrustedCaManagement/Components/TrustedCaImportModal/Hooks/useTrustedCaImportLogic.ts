import type { FormEvent } from 'react'
import { useForm } from '@tanstack/react-form'
import { useId, useState } from 'react'
import { toast } from '@rentnerkev/toasts/toast'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { createTrustedCaHandler, replaceTrustedCaHandler } from '../../../middleware.ts'
import { createTrustedCaInputSchema } from '../../../validation.ts'
import type { TrustedCaImportModalProps } from '../Types/trusted-ca-import-modal.types.ts'

export default function useTrustedCaImportLogic({
    trustedCa,
    onSuccess,
    onOpenChange,
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
    return {
        state: { formId, isPending, isReplace: trustedCa !== undefined },
        handler: {
            handleClose: () => onOpenChange(false),
            handleSubmit: (event: FormEvent<HTMLFormElement>) => {
                event.preventDefault()
                event.stopPropagation()
                void form.handleSubmit()
            },
        },
        form,
    }
}
