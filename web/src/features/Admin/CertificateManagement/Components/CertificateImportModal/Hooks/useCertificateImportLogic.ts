import type { FormEvent } from 'react'
import { useForm } from '@tanstack/react-form'
import { useId, useState } from 'react'
import { toast } from '@rentnerkev/toasts/toast'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { CertificateActionResult } from '@/shared/Types/certificates.types.ts'
import { importCertificateHandler, replaceCertificateHandler } from '../../../middleware.ts'
import { importCertificateInputSchema } from '../../../validation.ts'
import type { CertificateImportModalProps } from '../Types/certificate-import-modal.types.ts'

export default function useCertificateImportLogic({
    certificate,
    onSuccess,
    onOpenChange,
}: CertificateImportModalProps) {
    const { t } = useTranslationStore()
    const formId = useId()
    const [isPending, setIsPending] = useState(false)
    const form = useForm({
        defaultValues: {
            name: certificate?.name ?? '',
            certificatePem: '',
            privateKeyPem: '',
            chainPem: '',
        },
        onSubmit: async ({ value }) => {
            if (isPending) return
            setIsPending(true)
            try {
                const parsed = importCertificateInputSchema.parse(value)
                const result: CertificateActionResult = certificate
                    ? await replaceCertificateHandler({
                          data: { ...parsed, certificateId: certificate.id },
                      })
                    : await importCertificateHandler({ data: parsed })
                if (!result.success) {
                    toast.error(t(result.message), { title: t('toast.titles.error') })
                    return
                }
                form.reset({ name: '', certificatePem: '', privateKeyPem: '', chainPem: '' })
                toast.success(t(result.message), { title: t('toast.titles.success') })
                await onSuccess()
            } catch {
                toast.error(t('admin.certificates.errors.importFailed'), {
                    title: t('toast.titles.error'),
                })
            } finally {
                setIsPending(false)
            }
        },
    })
    return {
        state: { formId, isPending, isReplace: certificate !== undefined },
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
