import { sql } from 'drizzle-orm'
import { check, index, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core'
import type {
    AcmeEnvironment,
    CertificateErrorCode,
    CertificateOperation,
    CertificateSource,
    CertificateStoredStatus,
} from '../../config/certificates.config'
import { rentnerProxySchema } from './base'

export const certificates = rentnerProxySchema.table(
    'certificates',
    {
        id: uuid('id')
            .primaryKey()
            .default(sql`uuidv7()`),
        name: varchar('name', { length: 120 }).notNull(),
        source: varchar('source', { length: 10 }).$type<CertificateSource>().notNull(),
        environment: varchar('environment', { length: 10 }).$type<AcmeEnvironment>(),
        status: varchar('status', { length: 10 })
            .$type<CertificateStoredStatus>()
            .notNull()
            .default('pending'),
        operation: varchar('operation', { length: 10 })
            .$type<CertificateOperation>()
            .notNull()
            .default('idle'),
        issuedAt: timestamp('issued_at', { withTimezone: true, mode: 'date' }),
        expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
        issuer: varchar('issuer', { length: 512 }),
        fingerprint: varchar('fingerprint', { length: 71 }),
        lastErrorCode: varchar('last_error_code', { length: 64 }).$type<CertificateErrorCode>(),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        check('certificates_name_check', sql`length(btrim(${table.name})) > 0`),
        check('certificates_source_check', sql`${table.source} in ('manual', 'acme')`),
        check(
            'certificates_environment_check',
            sql`(${table.source} = 'manual' and ${table.environment} is null) or (${table.source} = 'acme' and ${table.environment} is not null and ${table.environment} in ('staging', 'production'))`,
        ),
        check('certificates_status_check', sql`${table.status} in ('pending', 'valid', 'failed')`),
        check(
            'certificates_operation_check',
            sql`${table.operation} in ('idle', 'issuing', 'renewing')`,
        ),
        check(
            'certificates_validity_check',
            sql`${table.status} != 'valid' or (${table.issuedAt} is not null and ${table.expiresAt} is not null and ${table.issuedAt} < ${table.expiresAt} and ${table.fingerprint} is not null)`,
        ),
        check(
            'certificates_fingerprint_check',
            sql`${table.fingerprint} is null or ${table.fingerprint} ~ '^sha256:[a-f0-9]{64}$'`,
        ),
        index('certificates_expires_at_idx').on(table.expiresAt),
    ],
)

export const certificateDomains = rentnerProxySchema.table(
    'certificate_domains',
    {
        id: uuid('id')
            .primaryKey()
            .default(sql`uuidv7()`),
        certificateId: uuid('certificate_id')
            .notNull()
            .references(() => certificates.id, { onDelete: 'cascade' }),
        domain: varchar('domain', { length: 253 }).notNull(),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        unique('certificate_domains_certificate_domain_unique').on(
            table.certificateId,
            table.domain,
        ),
        check(
            'certificate_domains_canonical_check',
            sql`${table.domain} ~ '^([*][.])?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$' and ${table.domain} !~ '^[0-9.]+$'`,
        ),
        index('certificate_domains_certificate_id_idx').on(table.certificateId),
    ],
)
