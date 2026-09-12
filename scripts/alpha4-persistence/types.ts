export type Command = (args: string[], timeoutMs?: number) => Promise<string>

export interface Alpha4CertificateRequest {
    readonly name: string
    readonly domains: readonly string[]
    readonly environment: 'staging'
    readonly challengeType: 'http-01'
    readonly contactEmail: ''
    readonly acceptTerms: true
}

export interface Alpha4PersistenceFixture {
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
    readonly request: Alpha4CertificateRequest
}

export interface Alpha4PersistenceIds {
    readonly ownerUserId: string
    readonly hostId: string
    readonly certificateId: string
    readonly jobId: string
    readonly idempotencyKey: string
    readonly operationId: string
    readonly eventIds: readonly [string, string]
}

export type Alpha4PersistenceSnapshot = Readonly<Record<string, unknown>>

export interface Alpha4PersistenceCommandInput {
    readonly command: Command
    readonly containerId: string
}

export interface SeedAlpha4PersistenceFixtureInput extends Alpha4PersistenceCommandInput {
    readonly runId: string
}

export interface AssertAlpha4PersistenceFixtureInput extends Alpha4PersistenceCommandInput {
    readonly fixture: Alpha4PersistenceFixture
}

export interface AssertAlpha4PersistenceSnapshotInput extends AssertAlpha4PersistenceFixtureInput {
    readonly expected: Alpha4PersistenceSnapshot
}
