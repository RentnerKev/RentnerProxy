import type { ControllerCertificateMetadata } from '@/server/Controller/Types/certificates.types.ts'
import type { CertificateJobManualDnsState } from './Types/certificate-jobs-storage.types.ts'

export function getCertificateJobManualDnsState(
    metadata: ControllerCertificateMetadata,
): CertificateJobManualDnsState {
    const operation = metadata.currentOperation
    if (operation?.dnsMode !== 'manual') return 'not_manual'
    if (
        metadata.status === 'failed' ||
        ['cancelled', 'expired', 'failed', 'needs_attention'].includes(operation.stage) ||
        ['cancelled', 'expired', 'failed'].includes(operation.manualDns?.status ?? '')
    )
        return 'failed'
    // Reused authorizations can omit manualDns entirely. Only an applied new certificate
    // proves completion; an old valid active certificate or an unactivated candidate does not.
    if (
        operation.stage === 'applied' &&
        metadata.operation === 'idle' &&
        metadata.status === 'valid' &&
        !metadata.candidate &&
        metadata.lastErrorCode === null &&
        (!operation.manualDns || operation.manualDns.status === 'complete')
    )
        return 'complete'
    return 'pending'
}
