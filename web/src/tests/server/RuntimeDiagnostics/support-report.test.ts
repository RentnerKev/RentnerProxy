import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

const script = `
    import { mock } from 'bun:test'
    import { supportReportFixture } from './tests/lib/RuntimeDiagnostics/runtime-support-report.fixture.ts'
    import { RUNTIME_SUPPORT_REPORT_PERMISSIONS } from './config/permissions.config.ts'
    const fixture = supportReportFixture()
    let permissions = []
    let signedIn = true
    let reads = 0
    let failCertificateQuery = false
    let failController = false
    let requests = []
    const headers = {}
    mock.module('@tanstack/react-start/server-only', () => ({}))
    mock.module('@tanstack/react-start', () => ({ createServerFn: () => ({ handler: (handler) => handler }) }))
    mock.module('@tanstack/react-start/server', () => ({ setResponseHeader: (key, value) => { headers[key] = value } }))
    const { AuthDomainError } = await import('./server/Auth/Core/errors.server.ts')
    mock.module('./server/Auth/Access/authorization.service.ts', () => ({
        requireUserService: async () => {
            if (!signedIn) throw new AuthDomainError('authentication_required', 'Sign in')
            return { permissions }
        },
    }))
    mock.module('./server/Auth/transport.server.ts', () => ({ throwLocalizedQueryError: (error) => { throw error } }))
    mock.module('./server/Controller/transport.server.ts', () => ({ controllerRequest: async (path, options) => {
        reads++
        requests.push({ path, options })
        if (failController) throw new Error('PRIVATE-CONTROLLER-FAILURE')
        return path === '/health' ? fixture.controllerHealth : fixture.caddyVersion
    } }))
    mock.module('./server/Controller/proxy.server.ts', () => ({ getProxyRuntimeStatus: async () => {
        reads++
        return failController ? null : fixture.runtimeStatus
    } }))
    mock.module('./server/Foundation/database-health.server.ts', () => ({ checkDatabaseHealth: async () => { reads++; return fixture.databaseHealth } }))
    mock.module('./server/Valkey/health.server.ts', () => ({ checkValkeyHealth: async () => { reads++; return fixture.valkeyHealth } }))
    mock.module('./server/RuntimeDiagnostics/support-report-data.ts', () => ({
        readSupportDesiredRevision: async () => { reads++; return fixture.desiredRevision },
        readSupportConfigurationCounts: async () => { reads++; return fixture.configuration },
        readSupportCertificateCounts: async () => {
            reads++
            if (failCertificateQuery) throw new Error('PRIVATE-SQL-FAILURE')
            return fixture.certificates
        },
        readSupportCertificateJobCounts: async () => { reads++; return fixture.certificateJobs },
    }))
    const { exportRuntimeSupportReportHandler } = await import('./features/Admin/RuntimeDiagnostics/middleware.ts')
    const denied = []
    for (const missing of RUNTIME_SUPPORT_REPORT_PERMISSIONS) {
        permissions = RUNTIME_SUPPORT_REPORT_PERMISSIONS.filter((permission) => permission !== missing)
        const code = await exportRuntimeSupportReportHandler().then(() => 'resolved', (error) => error.code)
        denied.push({ missing, code, reads })
    }
    permissions = [...RUNTIME_SUPPORT_REPORT_PERMISSIONS]
    signedIn = false
    const anonymous = await exportRuntimeSupportReportHandler().then(() => 'resolved', (error) => error.code)
    const anonymousReads = reads
    signedIn = true
    const healthy = await exportRuntimeSupportReportHandler()
    failCertificateQuery = true
    const partial = await exportRuntimeSupportReportHandler()
    failController = true
    const unavailable = await exportRuntimeSupportReportHandler()
    console.log(JSON.stringify({ denied, anonymous, anonymousReads, healthy, partial, unavailable, reads, requests, headers }))
`

describe('support report endpoint authorization and partial reads', () => {
    test('denies direct calls before any source read, permits authorized reads and contains failures', async () => {
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
            expect(output.denied).toHaveLength(3)
            for (const result of output.denied) {
                expect(result.code).toBe('permission_denied')
                expect(result.reads).toBe(0)
            }
            expect(output.anonymous).toBe('authentication_required')
            expect(output.anonymousReads).toBe(0)
            expect(output.reads).toBe(27)
            expect(output.healthy.completeness).toBe('complete')
            expect(output.healthy.runtime.state).toBe('synced')
            expect(output.partial.completeness).toBe('partial')
            expect(output.partial.certificates).toEqual({ state: 'unavailable', data: null })
            expect(output.partial.configuration.state).toBe('available')
            expect(output.unavailable.runtime.state).toBe('unavailable')
            expect(output.unavailable.versions.caddy.value).toBeNull()
            expect(stdout).not.toContain('PRIVATE-')
            expect(stdout).not.toContain('private.example.com')
            expect(output.headers).toEqual({
                'Cache-Control': 'private, no-store',
                'X-Content-Type-Options': 'nosniff',
            })
            expect(
                output.requests.filter(
                    (request: { path: string }) => request.path === '/internal/v1/proxy/version',
                ),
            ).toHaveLength(3)
            expect(output.requests[1].options).toEqual({
                timeoutMs: 2_000,
                privileged: true,
                allowNotFound: true,
            })
        } finally {
            clearTimeout(timer)
        }
    })
})
