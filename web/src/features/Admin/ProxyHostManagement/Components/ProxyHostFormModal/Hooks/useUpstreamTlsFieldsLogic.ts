import { useStore } from '@tanstack/react-form'
import { normalizeForwardHost } from '@/lib/Admin/ProxyHostManagement/proxyHostValidation.ts'
import type { ProxyHostFormFieldsProps } from '../Types/proxy-host-form.types.ts'
import type { UpstreamTlsFieldsLogicResult } from '../Types/form-fields-logic.types.ts'

export default function useUpstreamTlsFieldsLogic({
    form,
    assignableTrustedCas,
}: Pick<ProxyHostFormFieldsProps, 'form' | 'assignableTrustedCas'>): UpstreamTlsFieldsLogicResult {
    const scheme = useStore(form.store, (state) => state.values.forwardScheme)
    const verify = useStore(form.store, (state) => state.values.verifyUpstreamTls)
    const forwardHost = useStore(form.store, (state) => state.values.forwardHost)
    const trustedCaId = useStore(form.store, (state) => state.values.trustedCaId)
    const normalizedHost = normalizeForwardHost(forwardHost)
    return {
        handler: {
            handleVerifyChange: (checked) => {
                form.setFieldValue('verifyUpstreamTls', checked)
                if (!checked) form.setFieldValue('trustedCaId', null)
            },
        },
        state: {
            normalizedHost,
            visible: scheme === 'https',
            verifying: verify !== false,
            isIp:
                normalizedHost !== null &&
                (normalizedHost.includes(':') || /^\d+\.\d+\.\d+\.\d+$/u.test(normalizedHost)),
            selectedIsMissing:
                Boolean(trustedCaId) && !assignableTrustedCas.some((ca) => ca.id === trustedCaId),
        },
    }
}
