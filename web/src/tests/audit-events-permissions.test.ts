import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

const serviceScript = `
    import { mock } from 'bun:test'
    let queries = 0
    let actorQueries = 0
    let denied = true
    mock.module('./server/Auth/Access/authorization.service.ts', () => ({
        requirePermissionService: async () => {
            if (denied) throw new Error('permission denied')
            return { id: '0198d98a-0000-7000-8000-000000000001' }
        },
    }))
    mock.module('./db/index.ts', () => {
        const actorQuery = {
            from() { return actorQuery },
            orderBy() { return Promise.resolve([
                { id: '0198d98a-0000-7000-8000-000000000001', displayName: 'Alice Admin' },
            ]) },
        }
        return { db: { transaction: async (work) => {
            queries += 1
            const query = {
                from() { return query },
                leftJoin() { return query },
                where() { return query },
                orderBy() { return query },
                limit() { return Promise.resolve([]) },
            }
            return work({
                execute: async () => [],
                delete: () => ({ where: async () => [] }),
                select: () => query,
            })
        }, select: () => {
            actorQueries += 1
            return actorQuery
        } } }
    })
    const { listAuditActorOptionsService, listAuditEventsService } = await import('./server/Audit/audit-reader.service.ts')
    const deniedResult = await listAuditEventsService({}).then(
        () => 'resolved', (error) => error instanceof Error ? error.message : String(error),
    )
    const deniedQueries = queries
    const deniedActorResult = await listAuditActorOptionsService().then(
        () => 'resolved', (error) => error instanceof Error ? error.message : String(error),
    )
    const deniedActorQueries = actorQueries
    denied = false
    const authorizedResult = await listAuditEventsService({})
    const actorOptions = await listAuditActorOptionsService()
    console.log(JSON.stringify({ deniedResult, deniedQueries, deniedActorResult, deniedActorQueries, actorOptions, authorizedResult, queries, actorQueries }))
`

describe('audit viewer authorization', () => {
    test('checks AUDIT_LOGS_VIEW before opening a database transaction', async () => {
        const child = Bun.spawn([process.execPath, '-e', serviceScript], {
            cwd: fileURLToPath(new URL('../', import.meta.url)),
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
            readonly deniedResult: string
            readonly deniedQueries: number
            readonly deniedActorResult: string
            readonly deniedActorQueries: number
            readonly actorOptions: readonly { readonly id: string; readonly displayName: string }[]
            readonly authorizedResult: { readonly events: readonly unknown[] }
            readonly queries: number
            readonly actorQueries: number
        }
        expect(output.deniedResult).toBe('permission denied')
        expect(output.deniedQueries).toBe(0)
        expect(output.deniedActorResult).toBe('permission denied')
        expect(output.deniedActorQueries).toBe(0)
        expect(output.queries).toBe(2)
        expect(output.actorQueries).toBe(1)
        expect(output.actorOptions).toEqual([
            { id: '0198d98a-0000-7000-8000-000000000001', displayName: 'Alice Admin' },
        ])
        expect(output.authorizedResult.events).toEqual([])
    })
})
