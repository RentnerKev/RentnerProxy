import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

const serviceScript = `
    import { mock } from 'bun:test'
    import { PgDialect } from 'drizzle-orm/pg-core'
    import { PERMISSIONS } from './config/permissions.config.ts'
    const dialect = new PgDialect()
    const actor = { id: '0198d98a-0000-7000-8000-000000000001', permissions: Object.values(PERMISSIONS) }
    let denied = false
    const queries = []
    mock.module('@tanstack/react-start', () => ({
        createServerFn: ({ method }) => {
            let schema
            const builder = {
                validator(value) { schema = value; return builder },
                handler(callback) {
                    const handler = ({ data }) => callback({ data: schema.parse(data) })
                    handler.method = method
                    return handler
                },
            }
            return builder
        },
    }))
    mock.module('@tanstack/react-start/server', () => ({
        setResponseHeader: () => {},
        setResponseStatus: () => {},
    }))
    mock.module('./server/Auth/transport.server.ts', () => ({
        localizedActionFailure: () => ({ success: false }),
        throwLocalizedQueryError: (error) => { throw error },
    }))
    mock.module('./server/Auth/Access/authorization.service.ts', () => ({
        requirePermissionService: async () => {
            if (denied) throw new Error('permission denied')
            return actor
        },
        requireUserService: async () => actor,
    }))
    mock.module('./db/index.ts', () => ({
        db: { select: (fields) => {
            const record = { fields: Object.keys(fields), expressions: Object.fromEntries(
                Object.entries(fields).filter(([, value]) => value?.queryChunks).map(([key, value]) => [key, dialect.sqlToQuery(value)])
            ) }
            const query = {
                from(table) { record.table = table; return query },
                where(condition) { record.condition = dialect.sqlToQuery(condition); return query },
                orderBy(...order) { record.order = order.map(value => dialect.sqlToQuery(value)); return query },
                limit(limit) {
                    record.limit = limit
                    delete record.table
                    queries.push(record)
                    return Promise.resolve([{ id: actor.id, label: 'example.test', detail: 'safe detail' }])
                },
            }
            return query
        } },
    }))
    const services = [
        (await import('./server/Admin/ProxyHostManagement/proxy-hosts.service.ts')).searchProxyHostsService,
        (await import('./server/Admin/RedirectHostManagement/redirect-hosts.service.ts')).searchRedirectHostsService,
        (await import('./server/Admin/CertificateManagement/certificates.service.ts')).searchCertificatesService,
        (await import('./server/Admin/AccessPolicyManagement/access-policies.service.ts')).searchAccessPoliciesService,
    ]
    const outcomes = []
    for (const service of services) {
        const start = queries.length
        const missingPermission = await service({ ...actor, permissions: [] }, { query: 'valid' }).then(() => false, () => true)
        denied = true
        const revoked = await service(actor, { query: 'valid' }).then(() => false, () => true)
        denied = false
        const invalid = await Promise.all([
            { query: ' ' }, { query: 'x' }, { query: 'x'.repeat(129) },
            { query: 'valid', id: 'invalid' }, { query: 'valid', extra: true },
        ].map(input => service(actor, input).then(() => false, () => true)))
        const unauthorizedQueries = queries.length - start
        const result = await service(actor, { query: '  %_\\\\  ' })
        const selected = await service(actor, { query: 'unrelated', id: actor.id })
        outcomes.push({ missingPermission, revoked, invalid, unauthorizedQueries, result, selected })
    }
    const serviceQueries = [...queries]
    const handlers = [
        (await import('./features/Admin/ProxyHostManagement/middleware.ts')).searchProxyHostsHandler,
        (await import('./features/Admin/RedirectHostManagement/middleware.ts')).searchRedirectHostsHandler,
        (await import('./features/Admin/CertificateManagement/middleware.ts')).searchCertificatesHandler,
        (await import('./features/Admin/AccessPolicyManagement/middleware.ts')).searchAccessPoliciesHandler,
    ]
    const boundaries = []
    for (const handler of handlers) {
        const start = queries.length
        denied = true
        const refused = await handler({ data: { query: 'valid' } }).then(() => false, () => true)
        denied = false
        const beforeAllowed = queries.length - start
        const result = await handler({ data: { query: 'valid' } })
        boundaries.push({ method: handler.method, refused, beforeAllowed, result })
    }
    console.log(JSON.stringify({ queries: serviceQueries, outcomes, boundaries }))
`

describe('bounded authorized entity search', () => {
    test('guards every owner before database access and emits literal bounded lightweight SQL', async () => {
        const child = Bun.spawn([process.execPath, '--no-env-file', '-e', serviceScript], {
            cwd: fileURLToPath(new URL('../../..', import.meta.url)),
            env: {
                ...process.env,
                DATABASE_URL: 'postgres://test:test@127.0.0.1:1/quick_search_unit',
            },
            stdout: 'pipe',
            stderr: 'pipe',
        })
        const [stdout, stderr, exitCode] = await Promise.all([
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
            child.exited,
        ])
        expect(exitCode, stderr).toBe(0)
        const output = JSON.parse(stdout) as {
            queries: {
                fields: string[]
                expressions: Record<string, { sql: string; params: unknown[] }>
                condition: { sql: string; params: unknown[] }
                order: { sql: string; params: unknown[] }[]
                limit: number
            }[]
            outcomes: {
                missingPermission: boolean
                revoked: boolean
                invalid: boolean[]
                unauthorizedQueries: number
                result: { id: string; label: string; detail: string }[]
                selected: { id: string; label: string; detail: string }[]
            }[]
            boundaries: {
                method: string
                refused: boolean
                beforeAllowed: number
                result: { id: string; label: string; detail: string }[]
            }[]
        }
        expect(output.outcomes).toHaveLength(4)
        expect(output.queries).toHaveLength(8)
        expect(output.boundaries).toHaveLength(4)
        for (const boundary of output.boundaries) {
            expect(boundary.method).toBe('GET')
            expect(boundary.refused).toBe(true)
            expect(boundary.beforeAllowed).toBe(0)
            expect(Object.keys(boundary.result[0]!)).toEqual(['id', 'label', 'detail'])
        }
        for (const outcome of output.outcomes) {
            expect(outcome.missingPermission).toBe(true)
            expect(outcome.revoked).toBe(true)
            expect(outcome.invalid).toEqual([true, true, true, true, true])
            expect(outcome.unauthorizedQueries).toBe(0)
            expect(Object.keys(outcome.result[0]!)).toEqual(['id', 'label', 'detail'])
            expect(outcome.selected).toEqual(outcome.result)
        }
        for (const [index, query] of output.queries.entries()) {
            expect(query.fields).toEqual(['id', 'label', 'detail'])
            expect(query.order).toHaveLength(1)
            expect(query.order[0]!.sql).toContain('"id" asc')
            expect(query.limit).toBe(index % 2 === 0 ? 6 : 1)
            if (index % 2 === 1) {
                expect(query.condition.sql).not.toContain('ilike')
                expect(query.condition.params).toEqual(['0198d98a-0000-7000-8000-000000000001'])
            } else {
                expect(query.condition.sql).toContain('ilike')
                const targetColumns = [
                    ['forward_scheme', 'forward_host', 'forward_port'],
                    ['destination'],
                    ['name'],
                    ['name', 'description'],
                ][index / 2]!
                for (const column of targetColumns) {
                    expect(query.condition.sql).toContain(column)
                }
                expect(query.condition.params.every((value) => value === '%\\%\\_\\\\%')).toBe(true)
                if (index < 6) {
                    expect(query.condition.sql).toContain('exists (select 1')
                    const domain = query.expressions[index === 4 ? 'detail' : 'label']!
                    expect(domain.sql).toContain('order by')
                    expect(domain.sql).toContain('limit 1')
                }
            }
        }
    })
})
