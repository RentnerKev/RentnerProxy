import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'

import { buildNpmImportPlan, publicNpmPreview } from '../server/Admin/NpmImport/npm-plan'
import { NpmSourceError, readNpmSqliteSource } from '../server/Admin/NpmImport/npm-source'

// Based on the effective SQLite layout of upstream v2.16.0's Knex migrations,
// especially initial, customlocations, access_list_client, redirect_auto_scheme,
// and trust_forwarded_proto. No actual credentials or keys are used.
const migrationNames = `20180618015850_initial.js
20180929054513_websockets.js
20181019052346_forward_host.js
20181113041458_http2_support.js
20181213013211_forward_scheme.js
20190104035154_disabled.js
20190215115310_customlocations.js
20190218060101_hsts.js
20190227065017_settings.js
20200410143839_access_list_client.js
20200410143840_access_list_client_fix.js
20201014143841_pass_auth.js
20210210154702_redirection_scheme.js
20210210154703_redirection_status_code.js
20210423103500_stream_domain.js
20211108145214_regenerate_default_host.js
20240427161436_stream_ssl.js
20251111090000_redirect_auto_scheme.js
20260131163528_trust_forwarded_proto.js`.split('\n')

const directories: string[] = []
afterEach(async () => {
    await Promise.all(
        directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    )
})

async function fixture(): Promise<{ path: string; db: Database }> {
    const directory = await mkdtemp(join(tmpdir(), 'rp-npm-test-'))
    directories.push(directory)
    const path = join(directory, 'database.sqlite')
    const db = new Database(path, { create: true })
    db.exec(`
        create table knex_migrations (id integer primary key, name text not null, batch integer, migration_time text);
        create table proxy_host (
            id integer primary key, created_on text, modified_on text, owner_user_id integer,
            is_deleted integer not null default 0, domain_names text not null,
            forward_scheme text not null default 'http', forward_host text not null,
            forward_port integer not null, access_list_id integer not null default 0,
            certificate_id integer not null default 0, ssl_forced integer not null default 0,
            caching_enabled integer not null default 0, block_exploits integer not null default 0,
            advanced_config text not null default '', meta text not null default '{}',
            allow_websocket_upgrade integer not null default 0, http2_support integer not null default 0,
            enabled integer not null default 1, locations text, hsts_enabled integer not null default 0,
            hsts_subdomains integer not null default 0, trust_forwarded_proto integer not null default 0);
        create table redirection_host (
            id integer primary key, created_on text, modified_on text, owner_user_id integer,
            is_deleted integer not null default 0, domain_names text not null,
            forward_domain_name text not null, forward_scheme text not null default 'auto',
            forward_http_code integer not null default 302, preserve_path integer not null default 0,
            certificate_id integer not null default 0, ssl_forced integer not null default 0,
            block_exploits integer not null default 0, advanced_config text not null default '',
            meta text not null default '{}', http2_support integer not null default 0,
            enabled integer not null default 1, hsts_enabled integer not null default 0,
            hsts_subdomains integer not null default 0);
        create table access_list (
            id integer primary key, is_deleted integer not null default 0, name text not null,
            satisfy_any integer not null default 0, pass_auth integer not null default 1);
        create table access_list_auth (
            id integer primary key, access_list_id integer not null,
            username text not null, password text not null);
        create table access_list_client (
            id integer primary key, access_list_id integer not null,
            address text not null, directive text not null);
        create table certificate (
            id integer primary key, is_deleted integer not null default 0, provider text not null,
            nice_name text not null, domain_names text not null, meta text not null default '{}');
        create table dead_host (id integer primary key, is_deleted integer not null default 0,
            domain_names text not null default '[]');
        create table stream (id integer primary key, is_deleted integer not null default 0,
            incoming_port integer not null default 0);
    `)
    const insertMigration = db.query('insert into knex_migrations (name, batch) values (?, 1)')
    for (const name of migrationNames) insertMigration.run(name)
    return { path, db }
}

function proxy(db: Database, id: number, domain: string, extra = ''): void {
    db.query(`insert into proxy_host (id, domain_names, forward_host, forward_port,
        allow_websocket_upgrade, advanced_config) values (?, ?, 'backend.internal', 8080, 1, ?)`).run(
        id,
        JSON.stringify([domain]),
        extra,
    )
}

describe('NPM v2.16 SQLite source and migration preview', () => {
    test('reads real table shapes without reading plaintext auth passwords or certificate secrets', async () => {
        const { path, db } = await fixture()
        proxy(db, 1, 'app.example.test')
        db.exec(`insert into access_list (id, name) values (1, 'Staff');
            insert into access_list_auth (id, access_list_id, username, password)
            values (1, 1, 'alice', 'DO-NOT-EXPOSE-THIS-PASSWORD');
            insert into certificate (id, provider, nice_name, domain_names, meta)
            values (1, 'letsencrypt', 'App TLS', '["app.example.test"]',
                '{"dns_provider_credentials":"DO-NOT-EXPOSE-THIS-SECRET"}');`)
        db.close()
        const source = readNpmSqliteSource(path)
        expect(source.schema).toBe('npm-2.16-schema')
        expect(source.proxyHosts).toHaveLength(1)
        expect(source.certificates).toHaveLength(1)
        expect(JSON.stringify(source)).not.toContain('DO-NOT-EXPOSE')
        expect(source.authCounts).toEqual([{ access_list_id: 1, count: 1 }])
    })

    test('maps simple hosts, fixed redirects, and allow-only IP policies', async () => {
        const { path, db } = await fixture()
        proxy(db, 1, 'app.example.test')
        db.exec(`insert into access_list (id, name) values (3, 'Office');
            insert into access_list_client (id, access_list_id, address, directive)
            values (1, 3, '192.0.2.0/24', 'allow');
            update proxy_host set access_list_id = 3 where id = 1;
            insert into redirection_host (id, domain_names, forward_domain_name,
                forward_scheme, forward_http_code, preserve_path)
            values (2, '["old.example.test"]', 'new.example.test', 'https', 308, 1);`)
        db.close()
        const plan = buildNpmImportPlan(readNpmSqliteSource(path), 'a'.repeat(64), new Map())
        expect(plan.items.filter((item) => item.status === 'ready')).toHaveLength(2)
        expect(plan.items.find((item) => item.kind === 'proxy-host')?.status).toBe('partial')
        expect(
            plan.items.find((item) => item.kind === 'access-policy')?.policyInput?.ipRules,
        ).toEqual({ defaultAction: 'deny', allow: ['192.0.2.0/24'], deny: [] })
        expect(plan.items.find((item) => item.kind === 'proxy-host')?.accessListId).toBe(3)
        expect(
            plan.items.find((item) => item.kind === 'redirect-host')?.redirectInput?.statusCode,
        ).toBe(308)
    })

    test('marks certificates and changed semantics for manual review without activation', async () => {
        const { path, db } = await fixture()
        proxy(db, 1, 'tls.example.test')
        db.exec(`update proxy_host set certificate_id = 9, ssl_forced = 1 where id = 1;
            insert into certificate (id, provider, nice_name, domain_names)
            values (9, 'letsencrypt', 'TLS', '["tls.example.test"]');
            insert into redirection_host (id, domain_names, forward_domain_name, forward_scheme)
            values (2, '["auto.example.test"]', 'target.example.test', 'auto');`)
        db.close()
        const preview = publicNpmPreview(
            buildNpmImportPlan(readNpmSqliteSource(path), 'b'.repeat(64), new Map()),
        )
        expect(preview.items.find((item) => item.kind === 'proxy-host')?.status).toBe('partial')
        expect(preview.items.find((item) => item.kind === 'redirect-host')?.status).toBe('manual')
        expect(preview.items.find((item) => item.kind === 'certificate')?.reasons).toContain(
            'certificate_material_unavailable',
        )
        expect(JSON.stringify(preview)).not.toContain('private')
    })

    test('does not silently drop HTTPS and forwarded-protocol settings', async () => {
        const { path, db } = await fixture()
        proxy(db, 1, 'protocol.example.test')
        db.exec(`update proxy_host set ssl_forced = 1, http2_support = 1,
            trust_forwarded_proto = 1 where id = 1;
            insert into redirection_host (id, domain_names, forward_domain_name,
                forward_scheme, ssl_forced, http2_support)
            values (2, '["redirect.example.test"]', 'target.example.test', 'https', 1, 1);`)
        db.close()
        const plan = buildNpmImportPlan(readNpmSqliteSource(path), 'e'.repeat(64), new Map())
        const proxyHost = plan.items.find((item) => item.kind === 'proxy-host')
        const redirectHost = plan.items.find((item) => item.kind === 'redirect-host')
        expect(proxyHost?.status).toBe('partial')
        expect(proxyHost?.proxyInput?.enabled).toBe(false)
        expect(proxyHost?.reasons).toContain('force_https_manual')
        expect(proxyHost?.reasons).toContain('http2_behavior_review')
        expect(proxyHost?.reasons).toContain('forwarded_proto_review')
        expect(redirectHost?.status).toBe('partial')
        expect(redirectHost?.redirectInput?.enabled).toBe(false)
        expect(redirectHost?.reasons).toContain('force_https_manual')
        expect(redirectHost?.reasons).toContain('http2_behavior_review')
    })

    test('does not convert advanced nginx text and detects existing and source domain conflicts', async () => {
        const { path, db } = await fixture()
        proxy(db, 1, 'advanced.example.test', 'auth_request /external;')
        proxy(db, 2, 'duplicate.example.test')
        proxy(db, 3, 'duplicate.example.test')
        proxy(db, 4, 'existing.example.test')
        db.close()
        const preview = publicNpmPreview(
            buildNpmImportPlan(
                readNpmSqliteSource(path),
                'c'.repeat(64),
                new Map([['existing.example.test', 'proxy-host:123']]),
            ),
        )
        expect(preview.items.find((item) => item.sourceId === 1)?.reasons).toContain(
            'advanced_config_manual',
        )
        expect(
            preview.items.filter((item) => item.reasons.includes('source_duplicate_domain')),
        ).toHaveLength(2)
        expect(preview.items.find((item) => item.sourceId === 4)?.status).toBe('conflict')
        expect(JSON.stringify(preview)).not.toContain('auth_request')
    })

    test('changes the confirmation checksum when a domain becomes occupied', async () => {
        const { path, db } = await fixture()
        proxy(db, 1, 'race.example.test')
        db.close()
        const source = readNpmSqliteSource(path)
        const before = publicNpmPreview(buildNpmImportPlan(source, 'd'.repeat(64), new Map()))
        const after = publicNpmPreview(
            buildNpmImportPlan(
                source,
                'd'.repeat(64),
                new Map([['race.example.test', 'proxy-host:existing']]),
            ),
        )
        expect(before.fingerprint).toBe(after.fingerprint)
        expect(before.planFingerprint).not.toBe(after.planFingerprint)
        expect(after.counts.conflict).toBe(1)
    })

    test('rejects unknown schema and malformed SQLite instead of guessing', async () => {
        const { path, db } = await fixture()
        db.exec(
            "delete from knex_migrations where name = '20260131163528_trust_forwarded_proto.js'",
        )
        db.close()
        expect(() => readNpmSqliteSource(path)).toThrow(NpmSourceError)
        const directory = await mkdtemp(join(tmpdir(), 'rp-npm-invalid-'))
        directories.push(directory)
        const malformed = join(directory, 'database.sqlite')
        await writeFile(malformed, 'not a sqlite database')
        expect(() => readNpmSqliteSource(malformed)).toThrow(NpmSourceError)
    })
})
