import type { CertificateJobStage } from '@/shared/Types/certificate-jobs-config.types.ts'
export function isCertificateJobActive(stage: CertificateJobStage): boolean {
    return stage === 'preparing' || stage === 'issuing' || stage === 'applying'
}
