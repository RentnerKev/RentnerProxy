import { expect, test } from 'bun:test'
import { SQL } from 'bun'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/bun-sql'
import { eq } from 'drizzle-orm'
import * as schema from '@/db/schema.ts'
import {
    captureValidCertificateVersions,
    persistControllerCertificatesMetadataInTransaction,
} from '@/server/Admin/CertificateManagement/certificate-metadata.persistence.ts'
import { createCertificateMetadataSnapshotReader } from '@/server/Admin/CertificateManagement/certificate-metadata-snapshot.ts'
import type { ControllerCertificateMetadata } from '@/server/Controller/Types/certificates.types.ts'

const enabled = process.env.RENTNERPROXY_CERTIFICATE_METADATA_FIXTURE === '1'
const fixtureUrl = process.env.RENTNERPROXY_CERTIFICATE_METADATA_DATABASE_URL
const ids = [1, 2, 3, 4, 5].map((n) => `0198d98a-0000-7000-8000-${String(n).padStart(12, '0')}`)

const valid = (id: string, fingerprint = 'a') => ({
    id,
    name: 'fixture',
    source: 'manual' as const,
    status: 'valid' as const,
    issuedAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: new Date('2027-01-01T00:00:00Z'),
    fingerprint: 'sha256:' + fingerprint.repeat(64),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
})

test.skipIf(!enabled)(
    'xmin missing fences preserve separately committed imports/replaces and workers never mark missing',
    async () => {
        if (!fixtureUrl) throw new Error('Explicit certificate metadata fixture URL required')
        const url = new URL(fixtureUrl)
        if (
            !['postgres:', 'postgresql:'].includes(url.protocol) ||
            !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
            url.pathname !== '/certificate_metadata_fixture'
        ) {
            throw new Error(
                'Only the dedicated loopback certificate_metadata_fixture database is allowed',
            )
        }
        const client = new SQL(fixtureUrl, { max: 1 })
        const database = drizzle(client, { schema })
        const execute = (statement: string) => client.unsafe(statement)
        let ownedSchema = false
        try {
            await execute('create schema rentnerproxy')
            ownedSchema = true
            // Deliberately explicit fixture DDL, with separate committed mutations below.
            await execute(`create table rentnerproxy.certificates (
            id uuid primary key, name text not null, source text not null, environment text,
            status text not null default 'pending', operation text not null default 'idle',
            current_operation jsonb, challenge_type text, issued_at timestamptz, expires_at timestamptz,
            issuer text, fingerprint text, candidate jsonb, dns_cleanup_pending boolean not null default false,
            last_error_code text, last_activated_at timestamptz, last_error_at timestamptz,
            next_attempt_at timestamptz, attempt_count integer not null default 0,
            last_attempt_at timestamptz, last_success_at timestamptz, next_renewal_at timestamptz,
            controller_updated_at timestamptz, created_at timestamptz not null default now(),
            updated_at timestamptz not null default now());
            create table rentnerproxy.certificate_domains (
                id uuid primary key default uuidv7(), certificate_id uuid not null,
                domain text not null, created_at timestamptz not null default now());`)
            await database.transaction(async (tx) => {
                await tx.insert(schema.certificates).values([
                    valid(ids[0]!),
                    valid(ids[1]!),
                    valid(ids[2]!),
                    {
                        id: ids[4]!,
                        name: 'pending',
                        source: 'manual',
                        status: 'pending',
                        updatedAt: new Date('2026-01-02T00:00:00Z'),
                    },
                ])
            })
            const entered = Promise.withResolvers<void>()
            const release = Promise.withResolvers<void>()
            let requests = 0
            const read = createCertificateMetadataSnapshotReader({
                capture: () => captureValidCertificateVersions(database),
                readMetadata: async () => {
                    requests++
                    entered.resolve()
                    await release.promise
                    return []
                },
            })
            const first = read()
            await entered.promise
            const original = await captureValidCertificateVersions(database)
            expect(original.length).toBe(3)
            // Each transaction commits while GET is in flight. All updated_at values
            // intentionally stay equal; PostgreSQL xmin supplies the concurrency fence.
            await database.transaction(async (tx) => {
                await tx.insert(schema.certificates).values(valid(ids[3]!))
            })
            await database.transaction(async (tx) => {
                await tx
                    .update(schema.certificates)
                    .set({ fingerprint: 'sha256:' + 'b'.repeat(64) })
                    .where(eq(schema.certificates.id, ids[1]!))
            })
            await database.transaction(async (tx) => {
                await tx.delete(schema.certificates).where(eq(schema.certificates.id, ids[2]!))
                await tx.insert(schema.certificates).values(valid(ids[2]!, 'c'))
            })
            await database.transaction(async (tx) => {
                await tx
                    .update(schema.certificates)
                    .set({ ...valid(ids[4]!) })
                    .where(eq(schema.certificates.id, ids[4]!))
            })
            const current = await captureValidCertificateVersions(database)
            expect(current.find((row) => row.id === ids[1])?.xmin).not.toBe(
                original.find((row) => row.id === ids[1])?.xmin,
            )
            expect(current.find((row) => row.id === ids[2])?.xmin).not.toBe(
                original.find((row) => row.id === ids[2])?.xmin,
            )
            const joined = read()
            expect(joined).toBe(first)
            release.resolve()
            const [snapshot, shared] = await Promise.all([first, joined])
            expect(shared).toBe(snapshot)
            expect(snapshot.validBeforeRead).toEqual(original)
            expect(requests).toBe(1)
            await database.transaction((tx) =>
                persistControllerCertificatesMetadataInTransaction(
                    tx,
                    snapshot.metadata,
                    true,
                    snapshot.validBeforeRead,
                ),
            )
            const rows = await database
                .select()
                .from(schema.certificates)
                .orderBy(schema.certificates.id)
            expect(rows.map((row) => row.status)).toEqual([
                'failed',
                'valid',
                'valid',
                'valid',
                'valid',
            ])
            expect(rows[0]?.lastErrorCode).toBe('certificate_not_found')
            expect(rows[1]?.fingerprint).toBe('sha256:' + 'b'.repeat(64))
            expect(rows[2]?.fingerprint).toBe('sha256:' + 'c'.repeat(64))
            expect(rows[1]?.updatedAt.toISOString()).toBe('2026-01-02T00:00:00.000Z')
            // The later joiner's persistence still uses the original capture.
            await database.transaction((tx) =>
                persistControllerCertificatesMetadataInTransaction(
                    tx,
                    shared.metadata,
                    true,
                    shared.validBeforeRead,
                ),
            )
            expect((await captureValidCertificateVersions(database)).length).toBe(4)
            // Event/job persistence explicitly disables missing updates, even if a
            // caller were to supply a capture. Cursor/audit logic is outside this owner.
            const fresh = await read()
            expect(requests).toBe(2)
            expect(fresh.validBeforeRead.length).toBe(4)
            await database.transaction((tx) =>
                persistControllerCertificatesMetadataInTransaction(
                    tx,
                    [],
                    false,
                    fresh.validBeforeRead,
                ),
            )
            expect((await captureValidCertificateVersions(database)).length).toBe(4)
            const metadata: ControllerCertificateMetadata = {
                id: ids[1]!,
                source: 'manual',
                environment: null,
                domains: ['fixture.example'],
                status: 'valid',
                operation: 'idle',
                issuedAt: '2026-01-01T00:00:00Z',
                expiresAt: '2027-01-01T00:00:00Z',
                issuer: 'new issuer',
                fingerprint: 'sha256:' + 'd'.repeat(64),
                lastErrorCode: null,
                updatedAt: '2026-10-22T00:00:00Z',
            }
            await database.transaction((tx) =>
                persistControllerCertificatesMetadataInTransaction(tx, [metadata], false),
            )
            expect(
                (await database.select().from(schema.certificateDomains)).map((row) => row.domain),
            ).toEqual(['fixture.example'])
            await database.transaction((tx) =>
                persistControllerCertificatesMetadataInTransaction(
                    tx,
                    [
                        {
                            ...metadata,
                            fingerprint: 'sha256:' + 'e'.repeat(64),
                            domains: ['stale.example'],
                            updatedAt: '2026-10-21T00:00:00Z',
                        },
                    ],
                    false,
                ),
            )
            const [positive] = await database
                .select()
                .from(schema.certificates)
                .where(eq(schema.certificates.id, ids[1]!))
            expect(positive?.fingerprint).toBe(metadata.fingerprint)
            expect(
                (await database.select().from(schema.certificateDomains)).map((row) => row.domain),
            ).toEqual(['fixture.example'])
            // A positive metadata update also changes xmin: the older fresh capture
            // cannot mark that row missing, while unchanged captured rows do become missing.
            await database.transaction((tx) =>
                persistControllerCertificatesMetadataInTransaction(
                    tx,
                    [],
                    true,
                    fresh.validBeforeRead,
                ),
            )
            expect((await captureValidCertificateVersions(database)).map((row) => row.id)).toEqual([
                ids[1]!,
            ])
            await database.transaction((tx) =>
                persistControllerCertificatesMetadataInTransaction(tx, [], true, []),
            )
            expect((await captureValidCertificateVersions(database)).length).toBe(1)
            // Exercise the existing event-worker suite against only this owned fixture.
            // Its actual receipt, cursor CAS, audit and lifecycle code remains enabled.
            await execute(`create table rentnerproxy.system_settings (
            id uuid primary key default uuidv7(), key text unique not null, value jsonb not null,
            created_at timestamptz default now(), updated_at timestamptz default now());
            create table rentnerproxy.certificate_event_cursor (
                id integer primary key default 1, cursor text, updated_at timestamptz default now());
            create table rentnerproxy.certificate_event_receipts (
                event_id uuid primary key, operation_id uuid not null, certificate_id uuid not null,
                kind text not null, stage text not null, occurred_at timestamptz not null,
                error_code text, received_at timestamptz default now());
            create table rentnerproxy.audit_events (
                id uuid primary key default uuidv7(), created_at timestamptz default now(),
                actor_user_id uuid, actor_kind text not null, action text not null, resource text not null,
                target_id uuid, result text not null, metadata jsonb not null default '{}');`)
            const child = Bun.spawn(
                [
                    process.execPath,
                    '--no-env-file',
                    'test',
                    fileURLToPath(new URL('./certificate-events.db.test.ts', import.meta.url)),
                ],
                {
                    env: {
                        ...process.env,
                        DATABASE_URL: fixtureUrl,
                        RENTNERPROXY_DATABASE_INTEGRATION: '1',
                    },
                    stdout: 'pipe',
                    stderr: 'pipe',
                },
            )
            const [stdout, stderr, exitCode] = await Promise.all([
                new Response(child.stdout).text(),
                new Response(child.stderr).text(),
                child.exited,
            ])
            expect(exitCode, stdout + stderr).toBe(0)
            expect(stderr).toContain('5 pass')
            expect(stderr).toContain('0 fail')
            // The worker's full metadata response omitted this valid certificate.
            expect((await captureValidCertificateVersions(database)).map((row) => row.id)).toEqual([
                ids[1]!,
            ])
        } finally {
            if (ownedSchema) await execute('drop schema rentnerproxy cascade')
            await client.close()
        }
    },
    30_000,
)
