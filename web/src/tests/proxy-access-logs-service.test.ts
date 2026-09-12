import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

const serviceScript = `
    import { mock } from 'bun:test'

    const calls = []
    let denied = true
    const expectedResult = {
        entries: [],
        limit: 100,
        offset: 0,
        total: 0,
        hasMore: false,
        truncated: false,
    }

    mock.module('./server/Auth/Access/authorization.service.ts', () => ({
        requirePermissionService: async () => {
            if (denied) throw new Error('permission denied')
            return { id: '0198d98a-0000-7000-8000-000000000001' }
        },
    }))
    mock.module('./server/Foundation/controller.server.ts', () => ({
        getProxyAccessLogs: async (query) => {
            calls.push(query)
            return expectedResult
        },
    }))

    const { getProxyAccessLogsService } = await import(
        './server/Admin/ProxyAccessLogs/proxy-access-logs.service.ts'
    )
    const deniedResult = await getProxyAccessLogsService({}).then(
        () => 'resolved',
        (error) => error instanceof Error ? error.message : String(error),
    )
    denied = false
    const authorizedResult = await getProxyAccessLogsService({
        host: ' Example.COM. ',
        limit: 10,
        offset: 2,
    })
    console.log(JSON.stringify({ calls, deniedResult, authorizedResult }))
`

describe('proxy access-log service authorization', () => {
    test('denies before reaching the controller and returns authorized results', async () => {
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
            readonly calls: readonly unknown[]
            readonly deniedResult: string
            readonly authorizedResult: unknown
        }
        expect(output.deniedResult).toBe('permission denied')
        expect(output.calls).toEqual([{ host: 'example.com', limit: 10, offset: 2 }])
        expect(output.authorizedResult).toEqual({
            entries: [],
            limit: 100,
            offset: 0,
            total: 0,
            hasMore: false,
            truncated: false,
        })
    })
})
