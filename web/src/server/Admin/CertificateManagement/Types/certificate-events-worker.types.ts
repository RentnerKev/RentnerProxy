import type { CertificateEventMetadata } from '@/lib/Admin/CertificateManagement/Types/certificates.types.ts'

import type { ControllerCertificateMetadata } from '@/server/Controller/Types/certificates.types.ts'

export type Cursor = string | null

export interface FetchedEvents {
    readonly expectedCursor: Cursor
    readonly nextCursor: Cursor
    readonly resetRequired: boolean
    readonly events: readonly CertificateEventMetadata[]
    readonly metadata: readonly ControllerCertificateMetadata[]
}

export interface CursorSnapshot {
    readonly expectedCursor: Cursor

    readonly fetchCursor: Cursor
}
