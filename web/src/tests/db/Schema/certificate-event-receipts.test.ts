import { expect, test } from 'bun:test'
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core'

import {
    CERTIFICATE_EVENT_KINDS,
    CERTIFICATE_OPERATION_STAGES,
} from '@/config/certificates.config.ts'
import { certificateEventReceipts } from '@/db/Schema/certificates.ts'

test('receipt constraints accept every event kind and stage in the controller protocol', () => {
    const checks = getTableConfig(certificateEventReceipts).checks
    const dialect = new PgDialect()
    for (const [name, values] of [
        ['certificate_event_receipts_kind_check', CERTIFICATE_EVENT_KINDS],
        ['certificate_event_receipts_stage_check', CERTIFICATE_OPERATION_STAGES],
    ] as const) {
        const constraint = checks.find((check) => check.name === name)
        expect(constraint).toBeDefined()
        const sql = dialect.sqlToQuery(constraint!.value).sql
        expect([...sql.matchAll(/'([^']+)'/gu)].map((match) => match[1]).toSorted()).toEqual(
            [...values].toSorted(),
        )
    }
})
