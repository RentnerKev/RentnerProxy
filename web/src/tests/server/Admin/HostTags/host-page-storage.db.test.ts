import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { drizzle } from 'drizzle-orm/bun-sql'

import * as schema from '@/db/schema.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { createHostPageReader } from '@/server/Admin/HostTags/host-page-reader.server.ts'
import {
    readProxyHostListBasis,
    readRedirectHostListBasis,
} from '@/server/Admin/HostTags/host-list.storage.server.ts'
import { readProxyHostSummariesInTransaction } from '@/server/Admin/ProxyHostManagement/proxy-hosts.service.ts'
import { readRedirectHostSummariesInTransaction } from '@/server/Admin/RedirectHostManagement/redirect-hosts.service.ts'
import { readHostTags } from '@/server/Admin/HostTags/host-tags.storage.server.ts'
import { discoveryRegistry } from '@/tests/Helpers/discoveryFixture.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'

const enabled = process.env.RENTNERPROXY_HOST_PAGE_FIXTURE === '1'
const integrationTest = enabled ? test : test.skip
const queries: { query: string; params: unknown[] }[] = []
let client: SQL | undefined
const id = (index: number) => `0198d98a-0000-7000-8000-${String(index).padStart(12, '0')}`
const tag = { id: id(900), name: 'Büro' }
const state = { version: 1, revision: 1, tags: [tag], assignments: { [id(1)]: [tag.id] } }

function database() {
    if (!client) throw new Error('Host page fixture is not initialized.')
    return drizzle(client, {
        schema,
        logger: { logQuery: (query, params) => queries.push({ query, params }) },
    })
}

beforeAll(async () => {
    if (!enabled) return
    const url = new URL(process.env.DATABASE_URL ?? '')
    if (
        !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
        url.pathname !== '/host_page_fixture'
    )
        throw new Error('Host page tests require the dedicated local host_page_fixture database.')
    client = new SQL(url.toString())
    // Minimal disposable storage fixture only; this does not provision or migrate application databases.
    await client.unsafe(`
        create schema if not exists rentnerproxy;
        create table if not exists rentnerproxy.proxy_hosts (
            id uuid primary key, forward_scheme text not null, forward_host text not null,
            forward_port integer not null, enabled boolean not null, certificate_id uuid,
            force_https boolean not null default false, verify_upstream_tls boolean not null default true,
            upstream_tls_server_name text, trusted_ca_id uuid, access_policy_id uuid,
            created_at timestamptz not null, updated_at timestamptz not null
        );
        create table if not exists rentnerproxy.redirect_hosts (
            id uuid primary key, destination text not null, status_code integer not null,
            preserve_request_uri boolean not null, enabled boolean not null, certificate_id uuid,
            created_at timestamptz not null, updated_at timestamptz not null
        );
        create table if not exists rentnerproxy.host_domains (
            id uuid primary key default uuidv7(), proxy_host_id uuid, redirect_host_id uuid,
            domain text not null, created_at timestamptz not null default now()
        );
        create table if not exists rentnerproxy.system_settings (
            id uuid primary key default uuidv7(), key text unique not null, value jsonb not null,
            created_at timestamptz not null default now(), updated_at timestamptz not null default now()
        );
        create table if not exists rentnerproxy.certificate_binding_jobs (
            id uuid primary key, actor_user_id uuid, proxy_host_id uuid, certificate_id uuid,
            idempotency_key uuid, request_digest text, domains text[], required_permissions text[],
            host_revision text, assigned_revision text, desired_enabled boolean, desired_force_https boolean,
            request_ciphertext bytea, request_iv bytea, stage text, controller_stage text,
            controller_operation_id uuid, last_error_code text, attempt_count integer,
            retry_requested boolean, next_attempt_at timestamptz, lease_token uuid,
            lease_expires_at timestamptz, created_at timestamptz, updated_at timestamptz
        );
    `)
})

beforeEach(async () => {
    if (!enabled || !client) return
    await client.unsafe(
        'truncate rentnerproxy.host_domains, rentnerproxy.proxy_hosts, rentnerproxy.redirect_hosts, rentnerproxy.system_settings, rentnerproxy.certificate_binding_jobs',
    )
    const inserts: PromiseLike<unknown>[] = []
    for (const index of [1, 2, 3]) {
        inserts.push(
            client`insert into rentnerproxy.proxy_hosts (id, forward_scheme, forward_host, forward_port, enabled, upstream_tls_server_name, created_at, updated_at) values (${id(index)}, 'https', 'upstream.internal', 443, true, 'tls.internal', '2026-10-01', '2026-10-02')`,
        )
        inserts.push(
            client`insert into rentnerproxy.redirect_hosts (id, destination, status_code, preserve_request_uri, enabled, created_at, updated_at) values (${id(index + 10)}, 'https://upstream.internal/path', 308, false, true, '2026-10-01', '2026-10-02')`,
        )
        inserts.push(
            client`insert into rentnerproxy.host_domains (proxy_host_id, domain) values (${id(index)}, ${`app${index}.example.com`}), (${id(index)}, ${`alias${index}.example.com`})`,
        )
        inserts.push(
            client`insert into rentnerproxy.host_domains (redirect_host_id, domain) values (${id(index + 10)}, ${`redirect${index}.example.com`})`,
        )
        for (const job of [index + 100, index + 200]) {
            inserts.push(
                client`insert into rentnerproxy.certificate_binding_jobs (id, proxy_host_id, domains, stage, created_at, updated_at) values (${id(job)}, ${id(index)}, array['app.example.com'], 'applied', '2026-10-01', '2026-10-02')`,
            )
        }
    }
    await Promise.all(inserts)
    await client`insert into rentnerproxy.system_settings (key, value) values ('host_tags_proxy_v1', ${JSON.stringify(state)}::jsonb), ('host_tags_redirect_v1', ${JSON.stringify({ ...state, assignments: { [id(11)]: [tag.id] } })}::jsonb)`
    const registry = discoveryRegistry({
        owners: [
            {
                key: 'a'.repeat(64),
                sourceId: 'compose:app',
                hostId: id(1),
                containerId: 'b'.repeat(64),
                domains: ['app1.example.com'],
                state: 'managed',
                error: null,
            },
        ],
    })
    await client`insert into rentnerproxy.system_settings (key, value) values ('docker_discovery_management_v1', ${JSON.stringify(registry)}::jsonb)`
    queries.length = 0
})

afterAll(async () => {
    await client?.close()
})

describe('host page storage on isolated PostgreSQL', () => {
    integrationTest(
        'reads only base fields and groups all aliases without metadata hydration',
        async () => {
            await database().transaction(
                async (transaction) => {
                    const proxy = await readProxyHostListBasis(transaction)
                    const redirect = await readRedirectHostListBasis(transaction)
                    expect(proxy).toHaveLength(3)
                    expect(proxy[0]!.domains).toEqual(['alias1.example.com', 'app1.example.com'])
                    expect(Object.keys(proxy[0]!).toSorted()).toEqual(
                        [
                            'id',
                            'enabled',
                            'createdAt',
                            'certificateId',
                            'forwardHost',
                            'forwardScheme',
                            'forwardPort',
                            'domains',
                        ].toSorted(),
                    )
                    expect(redirect).toHaveLength(3)
                    expect(
                        queries.every(
                            ({ query }) =>
                                !query.includes('certificate_binding_jobs') &&
                                !query.includes('system_settings'),
                        ),
                    ).toBeTrue()
                },
                { isolationLevel: 'repeatable read', accessMode: 'read only' },
            )
        },
    )
    integrationTest(
        'hydrates selected IDs with complete summaries, latest job tie-break and discovery; empty IDs read nothing',
        async () => {
            await database().transaction(
                async (transaction) => {
                    const proxy = await readProxyHostSummariesInTransaction(transaction, [id(1)])
                    expect(proxy).toHaveLength(1)
                    expect(proxy[0]).toMatchObject({
                        id: id(1),
                        upstreamTlsServerName: 'tls.internal',
                        forwardScheme: 'https',
                        certificateJob: { id: id(201) },
                        discovery: { state: 'managed' },
                    })
                    const jobQuery = queries.find(({ query }) =>
                        query.includes('certificate_binding_jobs'),
                    )!
                    expect(jobQuery.params).toEqual([id(1)])
                    const redirect = await readRedirectHostSummariesInTransaction(transaction, [
                        id(11),
                    ])
                    expect(redirect).toHaveLength(1)
                    expect(redirect[0]).toMatchObject({
                        id: id(11),
                        preserveRequestUri: false,
                        statusCode: 308,
                    })
                    const count = queries.length
                    expect(await readProxyHostSummariesInTransaction(transaction, [])).toEqual([])
                    expect(await readRedirectHostSummariesInTransaction(transaction, [])).toEqual(
                        [],
                    )
                    expect(queries).toHaveLength(count)
                    expect(await readProxyHostSummariesInTransaction(transaction)).toHaveLength(3)
                    expect(await readRedirectHostSummariesInTransaction(transaction)).toHaveLength(
                        3,
                    )
                },
                { isolationLevel: 'repeatable read', accessMode: 'read only' },
            )
        },
    )
    integrationTest(
        'keeps tags and hydrated rows in the same repeatable-read snapshot during a concurrent tag update',
        async () => {
            const read = createHostPageReader({
                kind: 'proxy',
                permission: PERMISSIONS.PROXY_HOSTS_VIEW,
                authorize: async () => ({ id: 'authorized-test-actor' }),
                reauthorize: async () => undefined,
                transaction: <T>(run: (transaction: AuthTransaction) => Promise<T>) =>
                    database().transaction(run, {
                        isolationLevel: 'repeatable read',
                        accessMode: 'read only',
                    }),
                readTags: async (transaction, kind) => {
                    const captured = await readHostTags(transaction, kind)
                    await client!`update rentnerproxy.system_settings set value = ${JSON.stringify({ ...state, revision: 2, tags: [{ ...tag, name: 'Changed' }], assignments: {} })}::jsonb where key = 'host_tags_proxy_v1'`
                    return captured
                },
                readBasis: readProxyHostListBasis,
                readSummaries: async (transaction, ids) => {
                    expect((await readHostTags(transaction, 'proxy')).revision).toBe(1)
                    return readProxyHostSummariesInTransaction(transaction, ids)
                },
                labels: async () => ({ enabled: 'Aktiviert', disabled: 'Deaktiviert' }),
            })
            const page = await read({ search: 'BÜRO', pageSize: 1 })
            expect(page.total).toBe(1)
            expect(page.hosts[0]!.tags).toEqual([tag])
            expect(page.tags).toEqual([tag])
            expect(page.domains).toHaveLength(6)
            expect(page.hosts[0]!.certificateJob?.id).toBe(id(201))
        },
    )
})
