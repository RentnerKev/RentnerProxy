import { useForm } from '@tanstack/react-form'
import { useId, useState } from 'react'
import useToast from '../../../../shared/Toast/Hooks/useToast'
import type { CertificateActionResult } from '../../../../shared/Types/certificates.types'
import { requestCertificateHandler } from '../server'
import { requestCertificateInputSchema } from '../validation'
import type { CertificateRequestModalProps } from '../Types/certificate-management.types'

export default function useCertificateRequestLogic({
    initialDomains,
    initialName,
    onSuccess,
}: CertificateRequestModalProps) {
    const toast = useToast()
    const formId = useId()
    const [isPending, setIsPending] = useState(false)
    const form = useForm({
        defaultValues: {
            name: initialName ?? '',
            domains: initialDomains ? [...initialDomains] : [''],
            environment: 'staging',
            contactEmail: '',
            acceptTerms: false,
        },
        onSubmit: async ({ value }) => {
            if (isPending) return
            setIsPending(true)
            try {
                const parsed = requestCertificateInputSchema.parse(value)
                const result: CertificateActionResult = await requestCertificateHandler({
                    data: parsed,
                })
                if (!result.success) {
                    toast.error(result.message)
                    return
                }
                form.reset({
                    name: '',
                    domains: [''],
                    environment: 'staging',
                    contactEmail: '',
                    acceptTerms: false,
                })
                toast.success(result.message)
                onSuccess()
            } catch {
                toast.error('admin.certificates.errors.requestFailed')
            } finally {
                setIsPending(false)
            }
        },
    })
    return { form, formId, isPending }
}
