import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

import type { ProxyHostForwardScheme } from '../../config/proxy-hosts.config'
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

export const proxyHostDomains = rentnerProxySchema.table(
    'proxy_host_domains',
    {
        id: uuid('id')
            .primaryKey()
            .default(sql`uuidv7()`),
        proxyHostId: uuid('proxy_host_id')
            .notNull()
            .references(() => proxyHosts.id, { onDelete: 'cascade' }),
        domain: varchar('domain', { length: 253 })
            .notNull()
            .unique('proxy_host_domains_domain_unique'),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        check(
            'proxy_host_domains_domain_canonical_check',
            sql`${table.domain} ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$' and ${table.domain} !~ '^[0-9.]+$'`,
        ),
        index('proxy_host_domains_proxy_host_id_idx').on(table.proxyHostId),
    ],
)
