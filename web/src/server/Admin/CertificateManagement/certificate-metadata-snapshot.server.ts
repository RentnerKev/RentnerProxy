import '@tanstack/react-start/server-only'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { getControllerCertificates } from '@/server/Controller/certificates.server.ts'
import { createCertificateMetadataSnapshotReader } from './certificate-metadata-snapshot.ts'
import { captureValidCertificateVersions } from './certificate-metadata.persistence.ts'

// Only concurrent reads in this process share a capture/request. Once settled, the
// next read always captures current rows and performs a fresh controller request.
export const getCertificateMetadataSnapshot = createCertificateMetadataSnapshotReader({
    capture: () => captureValidCertificateVersions(getAuthDatabase()),
    readMetadata: getControllerCertificates,
})
