import type { controllerRequest } from '../transport.server.ts'
import type { SaveDnsConnectionInput } from '@/features/Admin/DnsConnections/Types/validation.types.ts'
import type { TestDnsConnectionInput } from '@/features/Admin/DnsConnections/Types/validation.types.ts'
import type {
    DnsConnection,
    DnsConnectionReference,
    DnsConnectionTestResult,
    ValidatedDnsConnectionReference,
} from '@/lib/DnsConnections/Types/dns-connections.types.ts'

export type DnsConnectionControllerRequest = typeof controllerRequest
export type SaveControllerDnsConnectionInput = Omit<SaveDnsConnectionInput, 'connectionId'> & {
    readonly actorUserId: string
}

export interface DnsConnectionsController {
    readonly list: () => Promise<readonly DnsConnection[]>
    readonly test: (input: TestDnsConnectionInput) => Promise<DnsConnectionTestResult>
    readonly save: (id: string, input: SaveControllerDnsConnectionInput) => Promise<DnsConnection>
    readonly delete: (id: string, expectedRevision: number) => Promise<void>
    readonly validateReference: (
        input: DnsConnectionReference,
    ) => Promise<ValidatedDnsConnectionReference>
}
