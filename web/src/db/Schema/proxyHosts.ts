import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

import type { ProxyHostForwardScheme } from '../../config/proxy-hosts.config'
import type { RedirectHostStatusCode } from '../../config/redirect-hosts.config'
import { rentnerProxySchema } from './base'
import { certificates } from './certificates'
import { trustedCas } from './trustedCas'

export const proxyHosts = rentnerProxySchema.table(
    'proxy_hosts',
    {
        id: uuid('id')
            .primaryKey()
            .default(sql`uuidv7()`),
        forwardScheme: varchar('forward_scheme', { length: 5 })
            .$type<ProxyHostForwardScheme>()
            .notNull(),
        forwardHost: varchar('forward_host', { length: 253 }).notNull(),
        forwardPort: integer('forward_port').notNull(),
        enabled: boolean('enabled').notNull().default(true),
        certificateId: uuid('certificate_id').references(() => certificates.id, {
            onDelete: 'restrict',
        }),
        forceHttps: boolean('force_https').notNull().default(false),
        verifyUpstreamTls: boolean('verify_upstream_tls').notNull().default(true),
        upstreamTlsServerName: varchar('upstream_tls_server_name', { length: 253 }),
        trustedCaId: uuid('trusted_ca_id').references(() => trustedCas.id, {
            onDelete: 'restrict',
        }),
        advancedConfig: text('advanced_config').notNull().default(''),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        check('proxy_hosts_forward_scheme_check', sql`${table.forwardScheme} in ('http', 'https')`),
        check('proxy_hosts_forward_port_check', sql`${table.forwardPort} between 1 and 65535`),
        check('proxy_hosts_forward_host_check', sql`length(btrim(${table.forwardHost})) > 0`),
        index('proxy_hosts_enabled_idx').on(table.enabled),
        index('proxy_hosts_certificate_id_idx').on(table.certificateId),
        index('proxy_hosts_trusted_ca_id_idx').on(table.trustedCaId),
        check(
            'proxy_hosts_trusted_ca_verification_check',
            sql`${table.trustedCaId} is null or (${table.forwardScheme} = 'https' and ${table.verifyUpstreamTls} = true)`,
        ),
        check(
            'proxy_hosts_force_https_check',
            sql`${table.forceHttps} = false or ${table.certificateId} is not null`,
        ),
    ],
)

export const redirectHosts = rentnerProxySchema.table(
    'redirect_hosts',
    {
        id: uuid('id')
            .primaryKey()
            .default(sql`uuidv7()`),
        destination: varchar('destination', { length: 2_048 }).notNull(),
        statusCode: integer('status_code').$type<RedirectHostStatusCode>().notNull().default(302),
        preserveRequestUri: boolean('preserve_request_uri').notNull().default(true),
        enabled: boolean('enabled').notNull().default(true),
        certificateId: uuid('certificate_id').references(() => certificates.id, {
            onDelete: 'restrict',
        }),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        check('redirect_hosts_status_code_check', sql`${table.statusCode} in (301, 302, 307, 308)`),
        index('redirect_hosts_enabled_idx').on(table.enabled),
        index('redirect_hosts_certificate_id_idx').on(table.certificateId),
    ],
)

export const hostDomains = rentnerProxySchema.table(
    'host_domains',
    {
        id: uuid('id')
            .primaryKey()
            .default(sql`uuidv7()`),
        proxyHostId: uuid('proxy_host_id').references(() => proxyHosts.id, {
            onDelete: 'cascade',
        }),
        redirectHostId: uuid('redirect_host_id').references(() => redirectHosts.id, {
            onDelete: 'cascade',
        }),
        domain: varchar('domain', { length: 253 }).notNull().unique('host_domains_domain_unique'),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        check(
            'host_domains_domain_canonical_check',
            sql`${table.domain} ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$' and ${table.domain} !~ '^[0-9.]+$'`,
        ),
        check(
            'host_domains_exactly_one_owner_check',
            sql`num_nonnulls(${table.proxyHostId}, ${table.redirectHostId}) = 1`,
        ),
        index('host_domains_proxy_host_id_idx').on(table.proxyHostId),
        index('host_domains_redirect_host_id_idx').on(table.redirectHostId),
    ],
)
