import type { Alpha4PersistenceFixture, Alpha4PersistenceSnapshot, Command } from './types'
import { uuidV7 } from './crypto'

const postgresPasswordFile = '/run/rentnerproxy/postgres/value'
const databaseName = 'rentnerproxy'
const databaseUser = 'rentnerproxy'

function shellQuote(value: string): string {
    return "'" + value.replaceAll("'", "'\"'\"'") + "'"
}

export function sqlQuote(value: string): string {
    return "'" + value.replaceAll("'", "''") + "'"
}

export function sqlTimestamp(value: Date | string): string {
    const serialized = value instanceof Date ? value.toISOString() : value
    return `${sqlQuote(serialized)}::timestamptz`
}

export function sqlJson(value: unknown): string {
    return `${sqlQuote(JSON.stringify(value))}::jsonb`
}

export function sqlTextArray(values: readonly string[]): string {
    return `ARRAY[${values.map(sqlQuote).join(',')}]::text[]`
}

export async function inContainer(
    command: Command,
    containerId: string,
    script: string,
    timeoutMs = 60_000,
): Promise<string> {
    return command(['docker', 'exec', containerId, 'sh', '-ceu', script], timeoutMs)
}

export async function readContainerFile(
    command: Command,
    containerId: string,
    path: string,
): Promise<string> {
    return inContainer(command, containerId, `cat ${path}`)
}

export async function psql(
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

function isCursor(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:\d+$/iu.test(value)
}

export async function readOrCreateCursor(
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

export function snapshotStatement(fixture: Alpha4PersistenceFixture): string {
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

function parseJsonRecord(value: string, label: string): Alpha4PersistenceSnapshot {
    try {
        const parsed: unknown = JSON.parse(value)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error(`Alpha 4 fixture returned invalid ${label}.`)
        }
        return parsed as Alpha4PersistenceSnapshot
    } catch (error) {
        if (error instanceof SyntaxError) {
            throw new Error(`Alpha 4 fixture returned invalid ${label}.`, { cause: error })
        }
        throw error
    }
}

export async function readAlpha4PersistenceSnapshot(
    command: Command,
    containerId: string,
    fixture: Alpha4PersistenceFixture,
): Promise<Alpha4PersistenceSnapshot> {
    const output = await psql(command, containerId, snapshotStatement(fixture))
    return parseJsonRecord(output, 'persistence snapshot')
}

export async function readEncryptedRequestParts(
    command: Command,
    containerId: string,
    jobId: string,
): Promise<{ readonly ciphertext: Buffer; readonly iv: Buffer }> {
    const encoded = (
        await psql(
            command,
            containerId,
            `select encode(request_ciphertext, 'base64') || E'\\t' || encode(request_iv, 'base64') from rentnerproxy.certificate_binding_jobs where id = ${sqlQuote(jobId)}`,
        )
    ).trim()
    const [ciphertextEncoded, ivEncoded] = encoded.split('\t')
    if (!ciphertextEncoded || !ivEncoded) throw new Error('encrypted request missing')
    const ciphertext = Buffer.from(ciphertextEncoded, 'base64')
    const iv = Buffer.from(ivEncoded, 'base64')
    if (ciphertext.byteLength < 17 || iv.byteLength !== 12) {
        throw new Error('encrypted request invalid')
    }
    return { ciphertext, iv }
}
