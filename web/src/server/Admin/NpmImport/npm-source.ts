// oxlint-disable-next-line import/no-unassigned-import -- Keep SQLite parsing out of client bundles.
import '@tanstack/react-start/server-only'

import { Database } from 'bun:sqlite'

export const NPM_IMPORT_MAX_BYTES = 32 * 1024 * 1024
const MAX_ROWS = 500

// Exact Knex migration names shipped by the upstream v2.16.0 tag.
export const NPM_216_MIGRATIONS = [
    '20180618015850_initial.js',
    '20180929054513_websockets.js',
    '20181019052346_forward_host.js',
    '20181113041458_http2_support.js',
    '20181213013211_forward_scheme.js',
    '20190104035154_disabled.js',
    '20190215115310_customlocations.js',
    '20190218060101_hsts.js',
    '20190227065017_settings.js',
    '20200410143839_access_list_client.js',
    '20200410143840_access_list_client_fix.js',
    '20201014143841_pass_auth.js',
    '20210210154702_redirection_scheme.js',
    '20210210154703_redirection_status_code.js',
    '20210423103500_stream_domain.js',
    '20211108145214_regenerate_default_host.js',
    '20240427161436_stream_ssl.js',
    '20251111090000_redirect_auto_scheme.js',
    '20260131163528_trust_forwarded_proto.js',
] as const

const REQUIRED_COLUMNS = {
    knex_migrations: ['name'],
    proxy_host: [
        'id',
        'is_deleted',
        'domain_names',
        'forward_scheme',
        'forward_host',
        'forward_port',
        'access_list_id',
        'certificate_id',
        'ssl_forced',
        'caching_enabled',
        'block_exploits',
        'advanced_config',
        'allow_websocket_upgrade',
        'http2_support',
        'enabled',
        'locations',
        'hsts_enabled',
        'hsts_subdomains',
        'trust_forwarded_proto',
    ],
    redirection_host: [
        'id',
        'is_deleted',
        'domain_names',
        'forward_domain_name',
        'forward_scheme',
        'forward_http_code',
        'preserve_path',
        'certificate_id',
        'ssl_forced',
        'block_exploits',
        'advanced_config',
        'http2_support',
        'enabled',
        'hsts_enabled',
        'hsts_subdomains',
    ],
    access_list: ['id', 'is_deleted', 'name', 'satisfy_any', 'pass_auth'],
    access_list_auth: ['id', 'access_list_id'],
    access_list_client: ['id', 'access_list_id', 'address', 'directive'],
    certificate: ['id', 'is_deleted', 'provider', 'nice_name', 'domain_names'],
    dead_host: ['id', 'is_deleted', 'domain_names'],
    stream: ['id', 'is_deleted', 'incoming_port'],
} as const

export class NpmSourceError extends Error {
    constructor(readonly code: 'invalid_source' | 'unsupported_schema' | 'source_limit') {
        super(code)
    }
}

export type NpmRecord = Record<string, unknown>

export interface NpmSource {
    readonly schema: 'npm-2.16-schema'
    readonly proxyHosts: readonly NpmRecord[]
    readonly redirectHosts: readonly NpmRecord[]
    readonly accessLists: readonly NpmRecord[]
    readonly accessClients: readonly NpmRecord[]
    readonly authCounts: readonly NpmRecord[]
    readonly certificates: readonly NpmRecord[]
    readonly deadHosts: readonly NpmRecord[]
    readonly streams: readonly NpmRecord[]
}

function queryRows(database: Database, sql: string): NpmRecord[] {
    return database.query(sql).all() as NpmRecord[]
}

function assertSchema(database: Database): void {
    const catalog = queryRows(
        database,
        "select name, type, sql from sqlite_schema where name not like 'sqlite_%'",
    )
    const objects = new Map(catalog.map((row) => [row.name, row]))
    for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
        const object = objects.get(table)
        if (
            object?.type !== 'table' ||
            typeof object.sql !== 'string' ||
            !/^\s*create\s+table\b/iu.test(object.sql)
        ) {
            throw new NpmSourceError('unsupported_schema')
        }
        // Table names are constants controlled by this module, never source input.
        const columns = queryRows(database, `pragma table_info(${table})`)
        const present = new Set(columns.map((row) => row.name))
        if (required.some((column) => !present.has(column))) {
            throw new NpmSourceError('unsupported_schema')
        }
    }
    const migrations = queryRows(database, 'select name from knex_migrations limit 100')
    const actual = new Set(migrations.map((row) => row.name))
    if (
        migrations.length !== NPM_216_MIGRATIONS.length ||
        actual.size !== NPM_216_MIGRATIONS.length ||
        NPM_216_MIGRATIONS.some((name) => !actual.has(name))
    ) {
        throw new NpmSourceError('unsupported_schema')
    }
}

function boundedRows(database: Database, sql: string): NpmRecord[] {
    const rows = queryRows(database, sql)
    if (rows.length > MAX_ROWS) throw new NpmSourceError('source_limit')
    return rows
}

export function readNpmSqliteSource(path: string): NpmSource {
    let database: Database | undefined
    try {
        database = new Database(path, { readonly: true, strict: true })
        assertSchema(database)
        const proxyHosts = boundedRows(
            database,
            `select id, domain_names, forward_scheme,
            forward_host, forward_port, access_list_id, certificate_id, ssl_forced,
            caching_enabled, block_exploits, length(advanced_config) as advanced_length,
            allow_websocket_upgrade, http2_support, enabled, locations, hsts_enabled,
            hsts_subdomains, trust_forwarded_proto from proxy_host where is_deleted = 0 order by id limit 501`,
        )
        const redirectHosts = boundedRows(
            database,
            `select id, domain_names, forward_domain_name,
            forward_scheme, forward_http_code, preserve_path, certificate_id, ssl_forced,
            block_exploits, length(advanced_config) as advanced_length, http2_support,
            enabled, hsts_enabled, hsts_subdomains from redirection_host
            where is_deleted = 0 order by id limit 501`,
        )
        const accessLists = boundedRows(
            database,
            `select id, name, satisfy_any, pass_auth
            from access_list where is_deleted = 0 order by id limit 501`,
        )
        const accessClients = boundedRows(
            database,
            `select id, access_list_id, address, directive
            from access_list_client order by id limit 501`,
        )
        // Never read NPM's plaintext access_list_auth.password into the process.
        const authCounts = boundedRows(
            database,
            `select access_list_id, count(*) as count
            from access_list_auth group by access_list_id order by access_list_id limit 501`,
        )
        // Certificate metadata only. PEM files, ACME state, and DNS credentials are separate.
        const certificates = boundedRows(
            database,
            `select id, provider, nice_name, domain_names
            from certificate where is_deleted = 0 order by id limit 501`,
        )
        const authRowCount = Number(
            queryRows(database, 'select count(*) as count from access_list_auth')[0]?.count ?? 0,
        )
        if (authRowCount > MAX_ROWS) throw new NpmSourceError('source_limit')
        const deadHosts = boundedRows(
            database,
            `select id, domain_names from dead_host
            where is_deleted = 0 order by id limit 501`,
        )
        const streams = boundedRows(
            database,
            `select id, incoming_port from stream
            where is_deleted = 0 order by id limit 501`,
        )
        return {
            schema: 'npm-2.16-schema',
            proxyHosts,
            redirectHosts,
            accessLists,
            accessClients,
            authCounts,
            certificates,
            deadHosts,
            streams,
        }
    } catch (error) {
        if (error instanceof NpmSourceError) throw error
        throw new NpmSourceError('invalid_source')
    } finally {
        database?.close()
    }
}
