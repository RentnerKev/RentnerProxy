import { useForm } from '@tanstack/react-form'
import { useId, useState } from 'react'
import useToast from '../../../../shared/Toast/Hooks/useToast'
import type { CertificateActionResult } from '../../../../shared/Types/certificates.types'
import { importCertificateHandler, replaceCertificateHandler } from '../server'
import { importCertificateInputSchema } from '../validation'
import type { CertificateImportModalProps } from '../Types/certificate-management.types'

export default function useCertificateImportLogic({
    certificate,
    onSuccess,
}: CertificateImportModalProps) {
    const toast = useToast()
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
                    toast.error(result.message)
                    return
                }
                form.reset({ name: '', certificatePem: '', privateKeyPem: '', chainPem: '' })
                toast.success(result.message)
                onSuccess()
            } catch {
                toast.error('admin.certificates.errors.importFailed')
            } finally {
                setIsPending(false)
            }
        },
    })
    return { form, formId, isPending }
}
