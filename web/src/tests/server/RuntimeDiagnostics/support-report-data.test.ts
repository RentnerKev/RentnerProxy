import { expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

const script = `
    import { mock } from 'bun:test'
    import { drizzle } from 'drizzle-orm/pg-proxy'
    const queries = []
    const options = []
    let revisionReads = 0
    const transaction = drizzle(async (query, params) => {
        queries.push({ query, params })
        return { rows: query.startsWith('select ') ? [new Array(100).fill(0)] : [] }
    })
    mock.module('@tanstack/react-start/server-only', () => ({}))
    mock.module('./server/Auth/Core/database.server.ts', () => ({ getAuthDatabase: () => ({
        transaction: async (work, config) => { options.push(config); return work(transaction) },
    }) }))
    mock.module('./server/ProxyRuntime/proxy-runtime-data.ts', () => ({ readProxyRuntimeSnapshot: async (tx) => {
        if (tx !== transaction || !queries.at(-1)?.query.includes('statement_timeout')) throw new Error('unbounded snapshot')
        revisionReads++
        return { revision: 'sha256:' + 'a'.repeat(64), privatePayload: 'PRIVATE-SNAPSHOT' }
    } }))
    const { readSupportConfigurationCounts, readSupportCertificateCounts, readSupportCertificateJobCounts, readSupportDesiredRevision } = await import('./server/RuntimeDiagnostics/support-report-data.ts')
    const configuration = await readSupportConfigurationCounts()
    const certificates = await readSupportCertificateCounts()
    const jobs = await readSupportCertificateJobCounts()
    const revision = await readSupportDesiredRevision()
    console.log(JSON.stringify({ queries, options, configuration, certificates, jobs, revision, revisionReads }))
`

test('support data queries aggregate only whitelisted states under read-only statement deadlines', async () => {
    const child = Bun.spawn([process.execPath, '--no-env-file', '-e', script], {
        cwd: fileURLToPath(new URL('../../..', import.meta.url)),
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const timer = setTimeout(() => child.kill(), 10_000)
    try {
        const [stdout, stderr, exitCode] = await Promise.all([
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
            child.exited,
        ])
        expect(exitCode, stderr).toBe(0)
        const output = JSON.parse(stdout)
        expect(output.options).toHaveLength(4)
        for (const config of output.options)
            expect(config).toEqual({ isolationLevel: 'repeatable read', accessMode: 'read only' })
        expect(
            output.queries.filter(
                (entry: { query: string }) =>
                    entry.query === "set local statement_timeout = '2000ms'",
            ),
        ).toHaveLength(4)
        const aggregates = output.queries.filter((entry: { query: string }) =>
            entry.query.startsWith('select '),
        )
        expect(aggregates).toHaveLength(4)
        for (const entry of aggregates) {
            expect(entry.query).toContain('count(*)')
            expect(entry.query).not.toMatch(
                /"(?:domains|domain|forward_host|destination|request_ciphertext|request_iv|actor_user_id|lease_token|name|issuer|fingerprint)"/u,
            )
            expect(entry.query).not.toContain('select *')
        }
        expect(output.configuration).toEqual({
            proxyHosts: { total: 0, enabled: 0 },
            redirectHosts: { total: 0, enabled: 0 },
        })
        expect(output.certificates.total).toBe(0)
        expect(output.jobs.total).toBe(0)
        expect(output.certificates.errors.other).toBe(0)
        expect(output.jobs.errors.permission_revoked).toBe(0)
        expect(output.revisionReads).toBe(1)
        expect(output.revision).toBe('sha256:' + 'a'.repeat(64))
        expect(stdout).not.toContain('PRIVATE-SNAPSHOT')
    } finally {
        clearTimeout(timer)
    }
})
