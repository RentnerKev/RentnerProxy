import type {
    Alpha4CertificateRequest,
    Alpha4PersistenceFixture,
    Alpha4PersistenceIds,
    Command,
} from './Types/persistence.types.ts'
import { decodeApplicationKey, digest } from './crypto.ts'
import { buildSeedStatements } from './seed-sql.ts'
import { psql, readContainerFile, readOrCreateCursor } from './storage.ts'

const appEncryptionKeyFile = '/run/rentnerproxy/app-key/value'

function validateRunId(runId: string): void {
    if (!/^[a-z0-9][a-z0-9_-]{5,63}$/u.test(runId)) {
        throw new Error('Alpha 4 fixture runId must be a bounded lowercase identifier.')
    }
}

function validateCommandInput(containerId: string): void {
    if (!containerId.trim() || containerId.length > 256) {
        throw new Error('Alpha 4 fixture container id is invalid.')
    }
}

function readFixtureIds(): Alpha4PersistenceIds {
    return {
        ownerUserId: Bun.randomUUIDv7(),
        hostId: Bun.randomUUIDv7(),
        certificateId: Bun.randomUUIDv7(),
        jobId: Bun.randomUUIDv7(),
        idempotencyKey: Bun.randomUUIDv7(),
        operationId: Bun.randomUUIDv7(),
        eventIds: [Bun.randomUUIDv7(), Bun.randomUUIDv7()],
    }
}

export async function seedAlpha4PersistenceFixture(input: {
    readonly command: Command
    readonly containerId: string
    readonly runId: string
    readonly withDnsCredential?: boolean
    readonly withCandidate?: boolean
}): Promise<Alpha4PersistenceFixture> {
    validateCommandInput(input.containerId)
    validateRunId(input.runId)
    const encodedKey = (
        await readContainerFile(input.command, input.containerId, appEncryptionKeyFile)
    ).trim()
    const key = decodeApplicationKey(encodedKey)
    const ids = readFixtureIds()
    const now = new Date()
    const operationStartedAt = new Date(now.getTime() - 10 * 60_000)
    const lastSuccessAt = new Date(now.getTime() - 24 * 60 * 60_000)
    const lastAttemptAt = new Date(now.getTime() - 5 * 60_000)
    const certificateCreatedAt = new Date(now.getTime() - 20 * 60_000)
    const jobCreatedAt = new Date(now.getTime() - 15 * 60_000)
    const issuedAt = new Date(now.getTime() - 30 * 24 * 60 * 60_000)
    const expiresAt = new Date(now.getTime() + 60 * 24 * 60 * 60_000)
    const nextRenewalAt = new Date(now.getTime() + 30 * 24 * 60 * 60_000)
    const identityDigest = digest({ runId: input.runId, ownerUserId: ids.ownerUserId })
    const domain = `a4-${identityDigest.slice(0, 32)}.example.com`
    const request: Alpha4CertificateRequest = {
        name: `Alpha 4 persistence ${input.runId}`,
        domains: [domain],
        environment: 'staging',
        challengeType: input.withDnsCredential ? 'dns-01' : 'http-01',
        ...(input.withDnsCredential
            ? {
                  dnsProvider: {
                      type: 'cloudflare' as const,
                      zoneId: 'a'.repeat(32),
                      apiToken: `compat-fixture-token-${input.runId}`,
                  },
              }
            : {}),
        contactEmail: '',
        acceptTerms: true,
    }
    const requestContext = `certificate-binding-job:${ids.jobId}`
    const candidate = input.withCandidate
        ? {
              fingerprint: `sha256:${digest({ runId: input.runId, candidate: true })}`,
              issuedAt: issuedAt.toISOString(),
              expiresAt: expiresAt.toISOString(),
              lastErrorCode: 'runtime_apply_failed' as const,
              nextAttemptAt: '2099-01-01T00:00:00.000Z',
          }
        : null
    const cursor = await readOrCreateCursor(input.command, input.containerId, now)
    const statements = buildSeedStatements(
        ids,
        { runId: input.runId },
        {
            key: key.bytes,
            now,
            operationStartedAt,
            lastSuccessAt,
            lastAttemptAt,
            certificateCreatedAt,
            jobCreatedAt,
            issuedAt,
            expiresAt,
            nextRenewalAt,
            domain,
            identityDigest,
            request,
            requestContext,
            candidate,
            cursorStatement: cursor.statement,
        },
    )
    await psql(input.command, input.containerId, statements.join(';\n') + ';', 60_000)
    return {
        runId: input.runId,
        ownerUserId: ids.ownerUserId,
        hostId: ids.hostId,
        certificateId: ids.certificateId,
        jobId: ids.jobId,
        idempotencyKey: ids.idempotencyKey,
        operationId: ids.operationId,
        eventIds: ids.eventIds,
        domain,
        cursor: cursor.cursor,
        applicationKeyDigest: key.digest,
        requestContext,
        request,
    }
}
