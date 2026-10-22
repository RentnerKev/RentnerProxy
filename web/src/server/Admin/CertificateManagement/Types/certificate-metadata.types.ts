import type { ControllerCertificateMetadata } from '@/server/Controller/Types/certificates.types.ts'

export interface CertificateMetadataVersion {
    readonly id: string
    readonly xmin: string
}

export interface CertificateMetadataSnapshot {
    readonly validBeforeRead: readonly CertificateMetadataVersion[]
    readonly metadata: readonly ControllerCertificateMetadata[]
}

export interface CertificateMetadataSnapshotDependencies {
    readonly capture: () => Promise<readonly CertificateMetadataVersion[]>
    readonly readMetadata: () => Promise<readonly ControllerCertificateMetadata[]>
}
