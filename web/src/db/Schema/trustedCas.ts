import { sql } from 'drizzle-orm'
import { check, index, text, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core'

import { rentnerProxySchema } from './base'

export const trustedCas = rentnerProxySchema.table(
    'trusted_cas',
    {
        id: uuid('id')
            .primaryKey()
            .default(sql`uuidv7()`),
        name: varchar('name', { length: 120 }).notNull(),
        pem: text('pem').notNull(),
        fingerprintSha256: varchar('fingerprint_sha256', { length: 71 }).notNull(),
        subject: varchar('subject', { length: 512 }).notNull(),
        issuer: varchar('issuer', { length: 512 }).notNull(),
        notBefore: timestamp('not_before', { withTimezone: true, mode: 'date' }).notNull(),
        notAfter: timestamp('not_after', { withTimezone: true, mode: 'date' }).notNull(),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        check('trusted_cas_name_check', sql`length(btrim(${table.name})) > 0`),
        check(
            'trusted_cas_fingerprint_sha256_check',
            sql`${table.fingerprintSha256} ~ '^sha256:[a-f0-9]{64}$'`,
        ),
        check('trusted_cas_validity_check', sql`${table.notBefore} < ${table.notAfter}`),
        check('trusted_cas_pem_limit_check', sql`octet_length(${table.pem}) between 1 and 262144`),
        unique('trusted_cas_fingerprint_sha256_unique').on(table.fingerprintSha256),
        index('trusted_cas_created_at_idx').on(table.createdAt),
    ],
)
