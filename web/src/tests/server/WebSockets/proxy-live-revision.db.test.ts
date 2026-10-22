import { expect, test } from 'bun:test'
import { SQL } from 'bun'
import { drizzle } from 'drizzle-orm/bun-sql'
import type { ProxyLiveTopic } from '@/server/WebSockets/Types/proxy-live-revision.types.ts'
import { proxyLiveDigestQuery } from '@/server/WebSockets/proxy-live-revision.sql.ts'

const fixtureEnabled = process.env.RENTNERPROXY_LIVE_REVISION_FIXTURE === '1'
const fixtureUrl = process.env.RENTNERPROXY_LIVE_REVISION_DATABASE_URL

// Mutations intentionally share one snapshot history and must run in order.
function sequence<T>(values: readonly T[], operation: (value: T) => Promise<void>) {
    return values.reduce(
        (previous, value) => previous.then(() => operation(value)),
        Promise.resolve(),
    )
}

test.skipIf(!fixtureEnabled)(
    'PostgreSQL live digests cover content mutations with bounded results at 50k domains',
    async () => {
        if (!fixtureUrl) throw new Error('Explicit live revision fixture URL required')
        const url = new URL(fixtureUrl)
        if (
            !['postgres:', 'postgresql:'].includes(url.protocol) ||
            !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
            url.pathname !== '/live_revision_fixture'
        ) {
            throw new Error('Only the dedicated loopback live_revision_fixture database is allowed')
        }
        const client = new SQL(fixtureUrl, { max: 1 })
        const database = drizzle(client)
        const execute = (statement: string) => client.unsafe(statement)
        const read = async (topic: ProxyLiveTopic = 'proxy-hosts') => {
            const rows = await database.execute<{ digest: string }>(proxyLiveDigestQuery(topic))
            expect(rows.length).toBe(1)
            expect(Object.keys(rows[0]!)).toEqual(['digest'])
            expect(rows[0]!.digest).toMatch(/^[a-f0-9]{64}$/)
            expect(JSON.stringify(rows).length).toBe(79)
            return rows[0]!.digest
        }
        const changes = async (statement: string, topic: ProxyLiveTopic = 'proxy-hosts') => {
            const before = await read(topic)
            await execute(statement)
            expect(await read(topic), statement).not.toBe(before)
        }
        const unchanged = async (statement: string, topic: ProxyLiveTopic = 'proxy-hosts') => {
            const before = await read(topic)
            await execute(statement)
            expect(await read(topic), statement).toBe(before)
        }
        await execute('begin')
        try {
            // Explicit fixture tables, never production migrations; everything is rolled back.
            await execute(`create schema rentnerproxy;
            create table rentnerproxy.proxy_hosts (
                id text primary key, forward_scheme text, forward_host text, forward_port integer,
                enabled boolean, certificate_id text, force_https boolean, verify_upstream_tls boolean,
                upstream_tls_server_name text, trusted_ca_id text, access_policy_id text,
                created_at timestamptz default '2026-01-01Z', updated_at timestamptz default '2026-01-01Z');
            create table rentnerproxy.redirect_hosts (
                id text primary key, destination text, status_code integer, preserve_request_uri boolean,
                enabled boolean, certificate_id text, created_at timestamptz default '2026-01-01Z', updated_at timestamptz default '2026-01-01Z');
            create table rentnerproxy.host_domains (id text primary key, proxy_host_id text, redirect_host_id text, domain text);
            create table rentnerproxy.access_policies (id text primary key, name text, description text,
                mode text, combination text, ip_rules jsonb, forward_auth jsonb,
                created_at timestamptz default '2026-01-01Z', updated_at timestamptz default '2026-01-01Z');
            create table rentnerproxy.access_policy_basic_auth_accounts (id text primary key, policy_id text, username text, password_hash text);
            create table rentnerproxy.trusted_cas (id text primary key, pem text, fingerprint_sha256 text);
            create table rentnerproxy.system_settings (key text primary key, value jsonb, updated_at timestamptz default now());
            create table rentnerproxy.certificate_binding_jobs (id text primary key, proxy_host_id text,
                certificate_id text, domains text[], stage text, controller_stage text, last_error_code text,
                created_at timestamptz default '2026-01-01Z', updated_at timestamptz default '2026-01-01Z', lease_token text);`)
            const empty = await read()
            await changes(
                `insert into rentnerproxy.proxy_hosts (id, forward_host, forward_port, enabled) values ('host', 'upstream', 80, true)`,
            )
            const oneHost = await read()
            await changes(`update rentnerproxy.proxy_hosts set forward_host = 'different'`)
            await execute(`update rentnerproxy.proxy_hosts set forward_host = 'upstream'`)
            expect(await read()).toBe(oneHost)
            // Every runtime routing field matters even with immutable updated_at.
            await sequence(
                [
                    "forward_scheme = 'https'",
                    'forward_port = 443',
                    'enabled = false',
                    "certificate_id = 'certificate'",
                    'force_https = true',
                    'verify_upstream_tls = false',
                    "upstream_tls_server_name = 'tls.example'",
                    "trusted_ca_id = 'ca'",
                    "access_policy_id = 'policy'",
                ],
                (assignment) => changes(`update rentnerproxy.proxy_hosts set ${assignment}`),
            )
            await changes(
                `insert into rentnerproxy.redirect_hosts (id, destination) values ('redirect', 'https://example.com')`,
            )
            await sequence(
                [
                    "destination = 'https://other.example'",
                    'status_code = 308',
                    'preserve_request_uri = true',
                    'enabled = false',
                    "certificate_id = 'redirect-cert'",
                ],
                (assignment) =>
                    changes(
                        `update rentnerproxy.redirect_hosts set ${assignment}`,
                        'redirect-hosts',
                    ),
            )
            await changes(
                `insert into rentnerproxy.host_domains values ('domain', 'host', null, 'example.com')`,
            )
            await changes(`update rentnerproxy.host_domains set domain = 'changed.example'`)
            await changes(
                `delete from rentnerproxy.host_domains; insert into rentnerproxy.host_domains values ('replacement', 'host', null, 'changed.example')`,
            )
            await changes(
                `update rentnerproxy.host_domains set proxy_host_id = null, redirect_host_id = 'redirect'`,
            )
            await changes(
                `insert into rentnerproxy.access_policies (id, name) values ('policy', 'policy')`,
                'access-policies',
            )
            await sequence(
                [
                    "name = 'renamed'",
                    "description = 'description'",
                    "mode = 'combined'",
                    "combination = 'all'",
                    `ip_rules = '{"defaultAction":"deny"}'`,
                    `forward_auth = '{"url":"https://auth.example"}'`,
                ],
                (assignment) =>
                    changes(
                        `update rentnerproxy.access_policies set ${assignment}`,
                        'access-policies',
                    ),
            )
            await changes(
                `insert into rentnerproxy.access_policy_basic_auth_accounts values ('account', 'policy', 'user', 'private-hash')`,
                'access-policies',
            )
            await changes(
                `update rentnerproxy.access_policy_basic_auth_accounts set password_hash = 'rotated-private-hash'`,
            )
            await changes(
                `update rentnerproxy.access_policy_basic_auth_accounts set username = 'renamed'`,
                'access-policies',
            )
            await changes(
                `update rentnerproxy.proxy_hosts set access_policy_id = null`,
                'access-policies',
            )
            await changes(
                `insert into rentnerproxy.trusted_cas values ('ca', 'private-pem', 'fingerprint')`,
            )
            await changes(`update rentnerproxy.trusted_cas set pem = 'rotated-private-pem'`)
            await changes(
                `update rentnerproxy.trusted_cas set fingerprint_sha256 = 'new-fingerprint'`,
            )
            await sequence(
                ['proxy_runtime_editor_v1', 'default_site_v1', 'proxy_runtime_host_v1:host'],
                async (key) => {
                    await changes(
                        `insert into rentnerproxy.system_settings (key, value) values ('${key}', '{"a":1}')`,
                    )
                    await changes(
                        `update rentnerproxy.system_settings set value = '{"a":2}' where key = '${key}'`,
                        'redirect-hosts',
                    )
                },
            )
            await unchanged(
                `insert into rentnerproxy.system_settings (key, value) values ('proxyXruntimeXhostXv1:host', '{}'), ('notification_runtime_v1', '{}')`,
            )
            await unchanged(
                `update rentnerproxy.system_settings set updated_at = now() + interval '1 hour'`,
            )
            await changes(
                `insert into rentnerproxy.system_settings (key, value) values ('host_tags_proxy_v1', '{"tags":[]}')`,
            )
            await changes(
                `update rentnerproxy.system_settings set value = '{"tags":["new"]}' where key = 'host_tags_proxy_v1'`,
            )
            await changes(
                `insert into rentnerproxy.system_settings (key, value) values ('host_tags_redirect_v1', '{"tags":[]}')`,
                'redirect-hosts',
            )
            await changes(
                `update rentnerproxy.system_settings set value = '{"tags":["new"]}' where key = 'host_tags_redirect_v1'`,
                'redirect-hosts',
            )
            await unchanged(
                `update rentnerproxy.system_settings set value = '{}' where key = 'host_tags_proxy_v1'`,
                'access-policies',
            )
            await changes(
                `insert into rentnerproxy.system_settings (key, value) values ('docker_discovery_management_v1', '{"owners":[{"hostId":"host","state":"managed"}],"runtimeStatus":1}')`,
            )
            await unchanged(
                `update rentnerproxy.system_settings set value = jsonb_set(value, '{runtimeStatus}', '2') where key = 'docker_discovery_management_v1'`,
            )
            await unchanged(
                `update rentnerproxy.system_settings set value = to_jsonb(value::text) where key = 'docker_discovery_management_v1'`,
            )
            await changes(
                `update rentnerproxy.system_settings set value = '{"owners":[{"hostId":"host","state":"detached"}]}' where key = 'docker_discovery_management_v1'`,
            )
            await changes(
                `insert into rentnerproxy.certificate_binding_jobs (id, proxy_host_id, domains, stage) values ('job-a', 'host', array['example.com'], 'preparing')`,
            )
            await unchanged(
                `update rentnerproxy.certificate_binding_jobs set lease_token = 'lease'`,
            )
            await sequence(
                [
                    "stage = 'issuing'",
                    "controller_stage = 'valid'",
                    "last_error_code = 'failed'",
                    "certificate_id = 'job-cert'",
                    "domains = array['changed.example']",
                ],
                (assignment) =>
                    changes(`update rentnerproxy.certificate_binding_jobs set ${assignment}`),
            )
            await changes(
                `insert into rentnerproxy.certificate_binding_jobs (id, proxy_host_id, stage) values ('job-z', 'host', 'applied')`,
            )
            await unchanged(
                `update rentnerproxy.certificate_binding_jobs set stage = 'failed' where id = 'job-a'`,
            )
            await unchanged(
                `insert into rentnerproxy.certificate_binding_jobs (id, proxy_host_id, stage) values ('orphan', null, 'failed')`,
            )
            await changes(
                `update rentnerproxy.certificate_binding_jobs set created_at = '2027-01-01Z' where id = 'job-a'`,
            )
            await unchanged(`set time zone 'UTC'; set time zone 'Europe/Berlin'`)
            await unchanged(`set time zone 'America/New_York'`)
            await changes(`delete from rentnerproxy.host_domains`)
            await changes(`insert into rentnerproxy.host_domains
            select 'scale-' || n, 'host', null, 'scale-' || n || '.example.com' from generate_series(1,50000) n`)
            const [domainCount] =
                await client`select count(*)::integer as count from rentnerproxy.host_domains`
            expect(domainCount.count).toBe(50_000)
            const scaleDigest = await read()
            await execute(`create temporary table reversed_domains as select * from rentnerproxy.host_domains order by id desc;
            delete from rentnerproxy.host_domains; insert into rentnerproxy.host_domains select * from reversed_domains`)
            expect(await read()).toBe(scaleDigest)
            await changes(
                `update rentnerproxy.host_domains set domain = 'last-change.example' where id = 'scale-50000'`,
            )
            await changes(`delete from rentnerproxy.host_domains where id = 'scale-50000'`)
            await execute(`truncate rentnerproxy.proxy_hosts, rentnerproxy.redirect_hosts, rentnerproxy.host_domains,
            rentnerproxy.access_policies, rentnerproxy.access_policy_basic_auth_accounts, rentnerproxy.trusted_cas,
            rentnerproxy.system_settings, rentnerproxy.certificate_binding_jobs`)
            expect(await read()).toBe(empty)
        } finally {
            await execute('rollback')
            await client.close()
        }
    },
    30_000,
)
