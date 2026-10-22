import { sql } from 'drizzle-orm'
import type { ProxyLiveTopic } from './Types/proxy-live-revision.types.ts'

// Fixed internal projections only. Hash complete rows inside PostgreSQL, then sort the
// fixed-width hashes: insertion order, session timezone and equal timestamps cannot
// hide changes. Scans/sorts remain proportional to stored data; only the result is bounded.
function component(source: string, projection: string): string {
    return `(select encode(sha256(convert_to(coalesce(string_agg(row_hash, '' order by row_hash collate "C"), ''), 'UTF8')), 'hex')
        from (select encode(sha256(convert_to(jsonb_build_array(${projection})::text, 'UTF8')), 'hex') row_hash from ${source}) projected)`
}

const common = [
    component(
        'rentnerproxy.proxy_hosts',
        `id, forward_scheme, forward_host, forward_port, enabled,
        certificate_id, force_https, verify_upstream_tls, upstream_tls_server_name, trusted_ca_id,
        access_policy_id, extract(epoch from created_at), extract(epoch from updated_at)`,
    ),
    component(
        'rentnerproxy.redirect_hosts',
        `id, destination, status_code, preserve_request_uri,
        enabled, certificate_id, extract(epoch from created_at), extract(epoch from updated_at)`,
    ),
    component('rentnerproxy.host_domains', 'id, proxy_host_id, redirect_host_id, domain'),
    component(
        'rentnerproxy.access_policies',
        `id, name, description, mode, combination, ip_rules,
        forward_auth, extract(epoch from created_at), extract(epoch from updated_at)`,
    ),
    component(
        'rentnerproxy.access_policy_basic_auth_accounts',
        'id, policy_id, username, password_hash',
    ),
    component('rentnerproxy.trusted_cas', 'id, pem, fingerprint_sha256'),
    component(
        `rentnerproxy.system_settings where key in ('proxy_runtime_editor_v1', 'default_site_v1')
        or starts_with(key, 'proxy_runtime_host_v1:')`,
        'key, value',
    ),
]

const latestJobs = component(
    `(select distinct on (j.proxy_host_id) j.id, j.proxy_host_id,
    j.certificate_id, j.domains, j.stage, j.controller_stage, j.last_error_code, j.created_at, j.updated_at
    from rentnerproxy.certificate_binding_jobs j
    where exists (select 1 from rentnerproxy.proxy_hosts h where h.id = j.proxy_host_id)
    order by j.proxy_host_id, j.created_at desc, j.id desc) latest_jobs`,
    `id, proxy_host_id,
    certificate_id, domains, stage, controller_stage, last_error_code,
    extract(epoch from created_at), extract(epoch from updated_at)`,
)

const proxyExtras = [
    component("rentnerproxy.system_settings where key = 'host_tags_proxy_v1'", 'key, value'),
    component(
        "rentnerproxy.system_settings where key = 'docker_discovery_management_v1'",
        `key,
        (case when jsonb_typeof(value) = 'string' then (value #>> '{}')::jsonb else value end) -> 'owners'`,
    ),
    latestJobs,
]

export function proxyLiveDigestQuery(topic: ProxyLiveTopic) {
    const extras =
        topic === 'proxy-hosts'
            ? proxyExtras
            : topic === 'redirect-hosts'
              ? [
                    component(
                        "rentnerproxy.system_settings where key = 'host_tags_redirect_v1'",
                        'key, value',
                    ),
                ]
              : []
    // One statement gives all independent components the same MVCC snapshot, without
    // joining domains, accounts and jobs into a multiplied intermediate collection.
    return sql.raw(
        `select encode(sha256(convert_to(jsonb_build_array(${[...common, ...extras].join(',')})::text, 'UTF8')), 'hex') as digest`,
    )
}
