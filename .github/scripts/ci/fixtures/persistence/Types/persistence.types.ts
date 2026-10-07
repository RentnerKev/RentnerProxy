import type { ApplianceCommand } from '../../Types/appliance-storage.types.ts'

export interface PersistenceCertificateRequest {
    readonly name: string
    readonly domains: readonly string[]
    readonly environment: 'staging'
    readonly challengeType: 'http-01' | 'dns-01'
    readonly dnsProvider?: {
        readonly type: 'cloudflare'
        readonly zoneId: string
        readonly apiToken: string
    }
    readonly contactEmail: ''
    readonly acceptTerms: true
}

export interface PersistenceFixture {
    readonly runId: string
    readonly ownerUserId: string
    readonly hostId: string
    readonly certificateId: string
    readonly jobId: string
    readonly idempotencyKey: string
    readonly operationId: string
    readonly eventIds: readonly string[]
    readonly domain: string
    readonly cursor: string
    readonly applicationKeyDigest: string
    readonly requestContext: string
    readonly request: PersistenceCertificateRequest
}

export interface PersistenceIds {
    readonly ownerUserId: string
    readonly hostId: string
    readonly certificateId: string
    readonly jobId: string
    readonly idempotencyKey: string
    readonly operationId: string
    readonly eventIds: readonly [string, string]
}

export type PersistenceSnapshot = Readonly<Record<string, unknown>>

export interface PersistenceCommandInput {
    readonly command: ApplianceCommand
    readonly containerId: string
}

export interface AssertPersistenceFixtureInput extends PersistenceCommandInput {
    readonly fixture: PersistenceFixture
}

export interface AssertPersistenceSnapshotInput extends AssertPersistenceFixtureInput {
    readonly expected: PersistenceSnapshot
}
