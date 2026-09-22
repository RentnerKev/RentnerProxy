import { useForm } from '@tanstack/react-form'
import { useId, useState } from 'react'
import { toast } from '@rentnerkev/toasts/toast'
import useTranslationStore from '../../../../language/useTranslationStore'
import type { CertificateActionResult } from '../../../../shared/Types/certificates.types'
import { importCertificateHandler, replaceCertificateHandler } from '../server'
import { importCertificateInputSchema } from '../validation'
import type { CertificateImportModalProps } from '../Types/certificate-management.types'

export default function useCertificateImportLogic({
    certificate,
    onSuccess,
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
    return { form, formId, isPending }
}
