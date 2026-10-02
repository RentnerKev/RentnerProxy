import { useStore } from '@tanstack/react-form'
import { certificateCoversDomains } from '@/lib/Admin/CertificateManagement/certificateValidation.ts'
import {
    getAccessPolicyAvailability,
    getBasicAuthAccountCount,
} from '@/lib/Admin/AccessPolicyManagement/basicAuthPolicyState.ts'
import type { ProxyHostFormFieldsProps } from '../Types/proxy-host-form.types.ts'
import type { ProxyHostFormFieldsLogicResult } from '../Types/form-fields-logic.types.ts'

export default function useProxyHostFormFieldsLogic({
    form,
    assignableCertificates,
    assignableAccessPolicies,
    requestNewCertificate,
    setRequestNewCertificate,
}: Pick<
    ProxyHostFormFieldsProps,
    | 'form'
    | 'assignableCertificates'
    | 'assignableAccessPolicies'
    | 'requestNewCertificate'
    | 'setRequestNewCertificate'
>): ProxyHostFormFieldsLogicResult {
    const domains = useStore(form.store, (state) => state.values.domains)
    const certificateId = useStore(form.store, (state) => state.values.certificateId)
    const accessPolicyId = useStore(form.store, (state) => state.values.accessPolicyId)
    const usableCertificates = assignableCertificates.filter(
        (certificate) =>
            (certificate.status === 'valid' || certificate.status === 'expiring') &&
            certificateCoversDomains(certificate.domains, domains),
    )
    const selectedCertificate = usableCertificates.find(
        (certificate) => certificate.id === certificateId,
    )
    const selectedPolicy = assignableAccessPolicies.find((policy) => policy.id === accessPolicyId)
    const availability = selectedPolicy
        ? getAccessPolicyAvailability(
              selectedPolicy.mode,
              selectedPolicy.combination,
              getBasicAuthAccountCount(selectedPolicy),
              selectedPolicy.ipRules,
          )
        : null
    return {
        state: {
            usableCertificates,
            availability,
            usable: requestNewCertificate || selectedCertificate !== undefined,
        },
        handler: {
            handleSchemeChange: (value) => {
                if (value !== 'http' && value !== 'https') return
                if (value !== form.getFieldValue('forwardScheme')) {
                    form.setFieldValue('verifyUpstreamTls', true)
                    form.setFieldValue('upstreamTlsServerName', null)
                    form.setFieldValue('trustedCaId', null)
                }
                form.setFieldValue('forwardScheme', value)
            },
            handleCertificateChange: (value) => {
                if (value === '__request-new__') {
                    form.setFieldValue('certificateId', null)
                    setRequestNewCertificate(true)
                    return
                }
                setRequestNewCertificate(false)
                form.setFieldValue('certificateId', value || null)
                if (!value) form.setFieldValue('forceHttps', false)
            },
        },
    }
}
