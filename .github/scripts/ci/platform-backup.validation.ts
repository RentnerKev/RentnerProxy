import { z } from 'zod'

const hash = z.string().regex(/^[a-f0-9]{64}$/u)
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u)
const uuid = z.uuid()

const bundleSchema = z.strictObject({
    schemaVersion: z.literal(1),
    source: z.strictObject({
        architecture: z.literal('amd64'),
        revision: z.string().regex(/^[a-f0-9]{40}$/u),
        version: z.string().min(1).max(128),
        manifestDigest: digest,
    }),
    backupState: z.strictObject({
        forwardAuthPolicyId: uuid,
        importerRunId: uuid,
        sourceFingerprint: hash,
        sourceSchema: z.literal('npm-2.16-schema'),
        expectedForwardAuthJson: z.string().max(32768),
        expectedImporterResultJson: z.string().max(32768),
    }),
    persistence: z.strictObject({
        runId: z.string().regex(/^[a-z0-9][a-z0-9_-]{5,63}$/u),
        ownerUserId: uuid,
        hostId: uuid,
        certificateId: uuid,
        jobId: uuid,
        idempotencyKey: uuid,
        operationId: uuid,
        eventIds: z.array(uuid).length(2),
        domain: z.string().min(1).max(253),
        cursor: z.string().regex(/^[a-f0-9-]{36}:[0-9]+$/iu),
        applicationKeyDigest: hash,
        requestContext: z.string().min(1).max(256),
        request: z.strictObject({
            name: z.string().min(1).max(256),
            domains: z.array(z.string().min(1).max(253)).min(1).max(2),
            environment: z.literal('staging'),
            challengeType: z.literal('dns-01'),
            dnsProvider: z.strictObject({
                type: z.literal('cloudflare'),
                zoneId: z.string().regex(/^[a-f0-9]{32}$/u),
                apiToken: z.string().min(1).max(256),
            }),
            contactEmail: z.literal(''),
            acceptTerms: z.literal(true),
        }),
    }),
    snapshot: z.record(z.string(), z.unknown()),
    files: z.strictObject({
        'metadata.json': hash,
        'app-encryption-key': hash,
        'postgres.dump': hash,
        'controller-state.tar': hash,
        'crowdsec-state.tar': hash,
    }),
})

export function parsePlatformBackupBundle(raw: unknown) {
    return bundleSchema.parse(raw)
}

export function validatePlatformBackupEntries(
    names: readonly string[],
    types: readonly string[],
): void {
    const expected = [
        'bundle.json',
        'backup/',
        'backup/metadata.json',
        'backup/app-encryption-key',
        'backup/postgres.dump',
        'backup/controller-state.tar',
        'backup/crowdsec-state.tar',
    ]
    if (
        names.length !== expected.length ||
        new Set(names).size !== expected.length ||
        !expected.every((name) => names.includes(name)) ||
        names.length !== types.length ||
        names.some((name, index) => types[index] !== (name === 'backup/' ? 'd' : '-'))
    )
        throw new Error('Portable backup archive contains unexpected paths or entry types')
}
