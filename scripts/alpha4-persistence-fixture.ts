import { deepStrictEqual } from 'node:assert/strict'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

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

const postgresPasswordFile = '/run/rentnerproxy/postgres/value'
const appEncryptionKeyFile = '/run/rentnerproxy/app-key/value'
const databaseName = 'rentnerproxy'
const databaseUser = 'rentnerproxy'
const futureAttemptAt = '2099-01-01T00:00:00.000Z'
const futureLeaseExpiresAt = '2099-01-02T00:00:00.000Z'
const appEncryptionKeyBytes = 32
const aesGcmIvBytes = 12

function shellQuote(value: string): string {
    return "'" + value.replaceAll("'", "'\"'\"'") + "'"
}

function sqlQuote(value: string): string {
    return "'" + value.replaceAll("'", "''") + "'"
}

function sqlTimestamp(value: Date | string): string {
    const serialized = value instanceof Date ? value.toISOString() : value
    return `${sqlQuote(serialized)}::timestamptz`
}

function sqlJson(value: unknown): string {
    return `${sqlQuote(JSON.stringify(value))}::jsonb`
}

function sqlTextArray(values: readonly string[]): string {
    return `ARRAY[${values.map(sqlQuote).join(',')}]::text[]`
}

function uuidV7(): string {
    const bytes = randomBytes(16)
    const timestamp = BigInt(Date.now())
    bytes[0] = Number((timestamp >> 40n) & 0xffn)
    bytes[1] = Number((timestamp >> 32n) & 0xffn)
    bytes[2] = Number((timestamp >> 24n) & 0xffn)
    bytes[3] = Number((timestamp >> 16n) & 0xffn)
    bytes[4] = Number((timestamp >> 8n) & 0xffn)
    bytes[5] = Number(timestamp & 0xffn)
    bytes[6] = (bytes[6]! & 0x0f) | 0x70
    bytes[8] = (bytes[8]! & 0x3f) | 0x80
    const hex = bytes.toString('hex')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function validateRunId(runId: string): void {
    if (!/^[a-z0-9][a-z0-9_-]{5,63}$/u.test(runId)) {
        throw new Error('Alpha 4 fixture runId must be a bounded lowercase identifier.')
    }
}

function validateCommandInput(input: Alpha4PersistenceCommandInput): void {
    if (!input.containerId.trim() || input.containerId.length > 256) {
        throw new Error('Alpha 4 fixture container id is invalid.')
    }
}

async function inContainer(
    command: Command,
    containerId: string,
    script: string,
    timeoutMs = 60_000,
): Promise<string> {
    return command(['docker', 'exec', containerId, 'sh', '-ceu', script], timeoutMs)
}

async function psql(
    command: Command,
    containerId: string,
    statement: string,
    timeoutMs = 60_000,
): Promise<string> {
    const script =
        'PGPASSWORD="$(cat ' +
        postgresPasswordFile +
        ')" gosu postgres psql --no-psqlrc --no-password --quiet --set=ON_ERROR_STOP=1 ' +
        '--tuples-only --no-align --host=127.0.0.1 --username=' +
        databaseUser +
        ' --dbname=' +
        databaseName +
        ' --command=' +
        shellQuote(statement)
    return inContainer(command, containerId, script, timeoutMs)
}

function digest(value: unknown): string {
    return createHash('sha256')
        .update(JSON.stringify(canonicalValue(value)))
        .digest('hex')
}

function canonicalValue(value: unknown): unknown {
    if (value instanceof Date) return value.toISOString()
    if (Array.isArray(value)) return value.map(canonicalValue)
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                .map(([key, entry]) => [key, canonicalValue(entry)]),
        )
    }
    return value
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Alpha 4 fixture returned invalid ${label}.`)
    }
    return value as Record<string, unknown>
}

function parseJsonRecord(value: string, label: string): Record<string, unknown> {
    try {
        return requireRecord(JSON.parse(value), label)
    } catch (error) {
        if (error instanceof SyntaxError) {
            throw new Error(`Alpha 4 fixture returned invalid ${label}.`, { cause: error })
        }
        throw error
    }
}

function readUuidFixtureIds(): {
    readonly ownerUserId: string
    readonly hostId: string
    readonly certificateId: string
    readonly jobId: string
    readonly idempotencyKey: string
    readonly operationId: string
    readonly eventIds: readonly [string, string]
} {
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

function encryptRequest(
    request: Alpha4CertificateRequest,
    key: Buffer,
    context: string,
): { readonly ciphertext: Buffer; readonly iv: Buffer } {
    const iv = randomBytes(aesGcmIvBytes)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(Buffer.from(context, 'utf8'))
    const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(request), 'utf8'),
        cipher.final(),
        cipher.getAuthTag(),
    ])
    return { ciphertext, iv }
}

async function readApplicationKey(
    command: Command,
    containerId: string,
): Promise<{ readonly bytes: Buffer; readonly digest: string }> {
    const encoded = (await inContainer(command, containerId, `cat ${appEncryptionKeyFile}`)).trim()
    const bytes = Buffer.from(encoded, 'base64')
    if (bytes.byteLength !== appEncryptionKeyBytes || bytes.toString('base64') !== encoded) {
        throw new Error('Alpha 4 fixture application encryption key is invalid.')
    }
    return { bytes, digest: createHash('sha256').update(bytes).digest('hex') }
}

function isCursor(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:\d+$/iu.test(value)
}

async function readOrCreateCursor(
    command: Command,
    containerId: string,
    now: Date,
): Promise<{ readonly cursor: string; readonly statement: string }> {
    const existing = (
        await psql(
            command,
            containerId,
            "select coalesce(cursor, '') from rentnerproxy.certificate_event_cursor where id = 1",
        )
    ).trim()
    if (isCursor(existing)) {
        return {
            cursor: existing,
            statement:
                'insert into rentnerproxy.certificate_event_cursor (id, cursor, updated_at) values (1, ' +
                sqlQuote(existing) +
                ', ' +
                sqlTimestamp(now) +
                ') on conflict (id) do nothing',
        }
    }
    const cursor = `${uuidV7()}:0`
    return {
        cursor,
        statement:
            'insert into rentnerproxy.certificate_event_cursor (id, cursor, updated_at) values (1, ' +
            sqlQuote(cursor) +
            ', ' +
            sqlTimestamp(now) +
            ') on conflict (id) do update set cursor = excluded.cursor, updated_at = excluded.updated_at',
    }
}

export async function seedAlpha4PersistenceFixture(
    input: SeedAlpha4PersistenceFixtureInput,
): Promise<Alpha4PersistenceFixture> {
    validateCommandInput(input)
    validateRunId(input.runId)
    const key = await readApplicationKey(input.command, input.containerId)
    const ids = readUuidFixtureIds()
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
    const encrypted = encryptRequest(request, key.bytes, requestContext)
    const certificateFingerprint = `sha256:${digest({ runId: input.runId, certificate: true })}`
    const host = {
        id: ids.hostId,
        forwardScheme: 'http',
        forwardHost: '127.0.0.1',
        forwardPort: 8080,
        enabled: false,
        certificateId: ids.certificateId,
        forceHttps: false,
        verifyUpstreamTls: true,
        upstreamTlsServerName: null,
        trustedCaId: null,
        accessPolicyId: null,
        createdAt: now,
        updatedAt: now,
    }
    const hostRevision = digest({ host, domains: [domain], httpSettings: {} })
    const requestDigest = digest({ proxyHostId: ids.hostId, host: null, request })
    const cursor = await readOrCreateCursor(input.command, input.containerId, now)
    const operation = {
        id: ids.operationId,
        kind: 'renew',
        stage: 'retry_scheduled',
        startedAt: operationStartedAt.toISOString(),
        updatedAt: now.toISOString(),
    }
    const statements = [
        'begin',
        'insert into rentnerproxy.users (id, display_name, email, status, created_at, updated_at) values (' +
            sqlQuote(ids.ownerUserId) +
            ', ' +
            sqlQuote(`Alpha 4 Fixture Owner ${input.runId}`) +
            ', ' +
            sqlQuote(`alpha4-${identityDigest.slice(0, 24)}@fixture.invalid`) +
            ", 'active', " +
            sqlTimestamp(certificateCreatedAt) +
            ', ' +
            sqlTimestamp(now) +
            ')',
        'insert into rentnerproxy.user_roles (user_id, role_id) select ' +
            sqlQuote(ids.ownerUserId) +
            ", id from rentnerproxy.roles where key = 'owner'",
        'insert into rentnerproxy.certificates (id, name, source, environment, status, operation, current_operation, challenge_type, issued_at, expires_at, issuer, fingerprint, candidate, dns_cleanup_pending, last_error_code, last_activated_at, last_error_at, next_attempt_at, attempt_count, last_attempt_at, last_success_at, next_renewal_at, controller_updated_at, created_at, updated_at) values (' +
            sqlQuote(ids.certificateId) +
            ', ' +
            sqlQuote(`Alpha 4 persistence ${input.runId}`) +
            ", 'acme', 'staging', 'valid', 'renewing', " +
            sqlJson(operation) +
            ", 'http-01', " +
            sqlTimestamp(issuedAt) +
            ', ' +
            sqlTimestamp(expiresAt) +
            ', ' +
            sqlQuote('Alpha 4 Fixture CA') +
            ', ' +
            sqlQuote(certificateFingerprint) +
            ', null, false, ' +
            sqlQuote('acme_failed') +
            ', ' +
            sqlTimestamp(lastSuccessAt) +
            ', ' +
            sqlTimestamp(lastAttemptAt) +
            ', ' +
            sqlTimestamp(futureAttemptAt) +
            ', 2, ' +
            sqlTimestamp(lastAttemptAt) +
            ', ' +
            sqlTimestamp(lastSuccessAt) +
            ', ' +
            sqlTimestamp(nextRenewalAt) +
            ', ' +
            sqlTimestamp(now) +
            ', ' +
            sqlTimestamp(certificateCreatedAt) +
            ', ' +
            sqlTimestamp(now) +
            ')',
        'insert into rentnerproxy.certificate_domains (certificate_id, domain, created_at) values (' +
            sqlQuote(ids.certificateId) +
            ', ' +
            sqlQuote(domain) +
            ', ' +
            sqlTimestamp(certificateCreatedAt) +
            ')',
        'insert into rentnerproxy.proxy_hosts (id, forward_scheme, forward_host, forward_port, enabled, certificate_id, force_https, verify_upstream_tls, upstream_tls_server_name, trusted_ca_id, access_policy_id, created_at, updated_at) values (' +
            sqlQuote(ids.hostId) +
            ", 'http', '127.0.0.1', 8080, false, " +
            sqlQuote(ids.certificateId) +
            ', false, true, null, null, null, ' +
            sqlTimestamp(now) +
            ', ' +
            sqlTimestamp(now) +
            ')',
        'insert into rentnerproxy.host_domains (proxy_host_id, domain, created_at) values (' +
            sqlQuote(ids.hostId) +
            ', ' +
            sqlQuote(domain) +
            ', ' +
            sqlTimestamp(now) +
            ')',
        'insert into rentnerproxy.certificate_binding_jobs (id, actor_user_id, proxy_host_id, certificate_id, idempotency_key, request_digest, domains, required_permissions, host_revision, assigned_revision, desired_enabled, desired_force_https, request_ciphertext, request_iv, stage, controller_stage, controller_operation_id, last_error_code, attempt_count, retry_requested, next_attempt_at, lease_token, lease_expires_at, created_at, updated_at) values (' +
            sqlQuote(ids.jobId) +
            ', ' +
            sqlQuote(ids.ownerUserId) +
            ', ' +
            sqlQuote(ids.hostId) +
            ', ' +
            sqlQuote(ids.certificateId) +
            ', ' +
            sqlQuote(ids.idempotencyKey) +
            ', ' +
            sqlQuote(requestDigest) +
            ', ' +
            sqlTextArray([domain]) +
            ', ' +
            sqlTextArray(['proxy_hosts.update', 'certificates.issue']) +
            ', ' +
            sqlQuote(hostRevision) +
            ', ' +
            sqlQuote(hostRevision) +
            ', false, false, decode(' +
            sqlQuote(encrypted.ciphertext.toString('base64')) +
            ", 'base64'), decode(" +
            sqlQuote(encrypted.iv.toString('base64')) +
            ", 'base64'), 'issuing', 'retry_scheduled', " +
            sqlQuote(ids.operationId) +
            ", 'acme_failed', 2, true, " +
            sqlTimestamp(futureAttemptAt) +
            ', ' +
            sqlQuote(uuidV7()) +
            ', ' +
            sqlTimestamp(futureLeaseExpiresAt) +
            ', ' +
            sqlTimestamp(jobCreatedAt) +
            ', ' +
            sqlTimestamp(now) +
            ')',
        'insert into rentnerproxy.certificate_event_receipts (event_id, operation_id, certificate_id, kind, stage, occurred_at, error_code, received_at) values (' +
            sqlQuote(ids.eventIds[0]) +
            ', ' +
            sqlQuote(ids.operationId) +
            ', ' +
            sqlQuote(ids.certificateId) +
            ", 'started', 'creating_order', " +
            sqlTimestamp(operationStartedAt) +
            ', null, ' +
            sqlTimestamp(now) +
            '), (' +
            sqlQuote(ids.eventIds[1]) +
            ', ' +
            sqlQuote(ids.operationId) +
            ', ' +
            sqlQuote(ids.certificateId) +
            ", 'retry_scheduled', 'retry_scheduled', " +
            sqlTimestamp(lastAttemptAt) +
            ', ' +
            sqlQuote('acme_failed') +
            ', ' +
            sqlTimestamp(now) +
            ')',
        cursor.statement,
        'commit',
    ]
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

function snapshotStatement(fixture: Alpha4PersistenceFixture): string {
    return `select jsonb_build_object(
        'fixtureVersion', 1,
        'user', (select to_jsonb(u) - 'password_hash' from rentnerproxy.users u where u.id = ${sqlQuote(fixture.ownerUserId)}),
        'userRoles', (select coalesce(jsonb_agg(to_jsonb(ur) order by ur.role_id), '[]'::jsonb) from rentnerproxy.user_roles ur where ur.user_id = ${sqlQuote(fixture.ownerUserId)}),
        'certificate', (select to_jsonb(c) from rentnerproxy.certificates c where c.id = ${sqlQuote(fixture.certificateId)}),
        'certificateDomains', (select coalesce(jsonb_agg(to_jsonb(d) order by d.domain, d.id), '[]'::jsonb) from rentnerproxy.certificate_domains d where d.certificate_id = ${sqlQuote(fixture.certificateId)}),
        'proxyHost', (select to_jsonb(h) from rentnerproxy.proxy_hosts h where h.id = ${sqlQuote(fixture.hostId)}),
        'hostDomains', (select coalesce(jsonb_agg(to_jsonb(d) order by d.domain, d.id), '[]'::jsonb) from rentnerproxy.host_domains d where d.proxy_host_id = ${sqlQuote(fixture.hostId)}),
        'job', (select (to_jsonb(j) - 'request_ciphertext' - 'request_iv') || jsonb_build_object('request_ciphertext_bytes', octet_length(j.request_ciphertext), 'request_ciphertext_md5', md5(encode(j.request_ciphertext, 'hex')), 'request_iv_bytes', octet_length(j.request_iv), 'request_iv_md5', md5(encode(j.request_iv, 'hex'))) from rentnerproxy.certificate_binding_jobs j where j.id = ${sqlQuote(fixture.jobId)}),
        'eventReceipts', (select coalesce(jsonb_agg(to_jsonb(r) order by r.event_id), '[]'::jsonb) from rentnerproxy.certificate_event_receipts r where r.event_id in (${fixture.eventIds.map(sqlQuote).join(',')})),
        'eventCursor', (select to_jsonb(c) from rentnerproxy.certificate_event_cursor c where c.id = 1)
    )::text`
}

export async function readAlpha4PersistenceSnapshot(
    input: AssertAlpha4PersistenceFixtureInput,
): Promise<Alpha4PersistenceSnapshot> {
    validateCommandInput(input)
    const output = await psql(input.command, input.containerId, snapshotStatement(input.fixture))
    return parseJsonRecord(output, 'persistence snapshot')
}

export async function assertAlpha4PersistenceFixture(
    input: AssertAlpha4PersistenceSnapshotInput,
): Promise<void> {
    const actual = await readAlpha4PersistenceSnapshot(input)
    try {
        deepStrictEqual(actual, input.expected)
    } catch {
        throw new Error('Alpha 4 persistence fixture snapshot did not survive backup restore.')
    }
}

export async function assertAlpha4PersistenceRequestDecrypts(
    input: AssertAlpha4PersistenceFixtureInput,
): Promise<void> {
    validateCommandInput(input)
    try {
        const key = await readApplicationKey(input.command, input.containerId)
        if (key.digest !== input.fixture.applicationKeyDigest) {
            throw new Error('application key changed')
        }
        const encoded = (
            await psql(
                input.command,
                input.containerId,
                `select encode(request_ciphertext, 'base64') || E'\\t' || encode(request_iv, 'base64') from rentnerproxy.certificate_binding_jobs where id = ${sqlQuote(input.fixture.jobId)}`,
            )
        ).trim()
        const [ciphertextEncoded, ivEncoded] = encoded.split('\t')
        if (!ciphertextEncoded || !ivEncoded) throw new Error('encrypted request missing')
        const ciphertext = Buffer.from(ciphertextEncoded, 'base64')
        const iv = Buffer.from(ivEncoded, 'base64')
        if (ciphertext.byteLength < 17 || iv.byteLength !== aesGcmIvBytes) {
            throw new Error('encrypted request invalid')
        }
        const decipher = createDecipheriv('aes-256-gcm', key.bytes, iv)
        decipher.setAAD(Buffer.from(input.fixture.requestContext, 'utf8'))
        decipher.setAuthTag(ciphertext.subarray(-16))
        const plaintext = Buffer.concat([
            decipher.update(ciphertext.subarray(0, -16)),
            decipher.final(),
        ]).toString('utf8')
        const request = JSON.parse(plaintext)
        deepStrictEqual(request, input.fixture.request)
    } catch {
        throw new Error('Alpha 4 persistence fixture encrypted request could not be decrypted.')
    }
}
