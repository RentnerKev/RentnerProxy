import type {
    CertificateMetadataSnapshot,
    CertificateMetadataSnapshotDependencies,
} from './Types/certificate-metadata.types.ts'

export function createCertificateMetadataSnapshotReader(
    dependencies: CertificateMetadataSnapshotDependencies,
) {
    let inFlight: Promise<CertificateMetadataSnapshot> | null = null
    return (): Promise<CertificateMetadataSnapshot> => {
        if (inFlight) return inFlight
        const shared = Promise.resolve()
            .then(async () => {
                const validBeforeRead = await dependencies.capture()
                const metadata = await dependencies.readMetadata()
                return { validBeforeRead, metadata }
            })
            .finally(() => {
                if (inFlight === shared) inFlight = null
            })
        inFlight = shared
        return shared
    }
}
