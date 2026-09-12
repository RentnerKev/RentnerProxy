import type {
    Alpha4CertificateRequest,
    Alpha4PersistenceFixture,
    Alpha4PersistenceIds,
    Command,
} from './types'
import { decodeApplicationKey, digest, uuidV7 } from './crypto'
import { buildSeedStatements } from './seed-sql'
import { psql, readContainerFile, readOrCreateCursor } from './storage'

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
        ownerUserId: uuidV7(),
        hostId: uuidV7(),
        certificateId: uuidV7(),
        jobId: uuidV7(),
        idempotencyKey: uuidV7(),
        operationId: uuidV7(),
        eventIds: [uuidV7(), uuidV7()],
    }
}

export async function seedAlpha4PersistenceFixture(input: {
    readonly command: Command
    readonly containerId: string
    readonly runId: string
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
        challengeType: 'http-01',
        contactEmail: '',
        acceptTerms: true,
    }
    const requestContext = `certificate-binding-job:${ids.jobId}`
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
