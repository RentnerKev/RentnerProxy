import type { CertificateJobStage } from '@/config/Types/certificate-jobs-config.types.ts'
export function isCertificateJobActive(stage: CertificateJobStage): boolean {
    return stage === 'preparing' || stage === 'issuing' || stage === 'applying'
}
